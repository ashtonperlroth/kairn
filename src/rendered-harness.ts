import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import type { RuntimeTarget } from "./types.js";

export interface RenderedHarnessMetadata {
  schemaVersion: 1;
  target?: RuntimeTarget;
  source?: string;
}

export interface RenderedHarnessFileMetadata {
  byteLength: number;
  sha256: string;
  lineCount: number;
  source?: string;
}

export interface RenderedHarnessFile {
  path: string;
  content: string;
  metadata: RenderedHarnessFileMetadata;
}

export interface RenderedHarness {
  metadata: RenderedHarnessMetadata;
  files: ReadonlyMap<string, RenderedHarnessFile>;
}

export interface RenderedHarnessEntry {
  path: string;
  content: string;
  source?: string;
}

export class InvalidRenderedHarnessPathError extends Error {
  constructor(
    public readonly filePath: string,
    reason: string,
  ) {
    super(`Invalid rendered harness path "${filePath}": ${reason}.`);
    this.name = "InvalidRenderedHarnessPathError";
  }
}

function hasPathTraversalSegment(filePath: string): boolean {
  return filePath
    .replace(/\\/g, "/")
    .split("/")
    .some((segment) => segment === "..");
}

export function sanitizeRenderedHarnessPath(filePath: string): string {
  if (filePath.includes("\0")) {
    throw new InvalidRenderedHarnessPathError(
      filePath,
      "NUL bytes are not allowed",
    );
  }

  if (filePath.length === 0) {
    throw new InvalidRenderedHarnessPathError(
      filePath,
      "path must not be empty",
    );
  }

  if (
    /^[a-zA-Z]:[\\/]/.test(filePath) ||
    filePath.startsWith("/") ||
    filePath.startsWith("\\")
  ) {
    throw new InvalidRenderedHarnessPathError(
      filePath,
      "absolute paths are not target-root relative",
    );
  }

  if (hasPathTraversalSegment(filePath)) {
    throw new InvalidRenderedHarnessPathError(
      filePath,
      "path traversal segments are not allowed",
    );
  }

  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new InvalidRenderedHarnessPathError(
      filePath,
      "path must resolve inside the target root",
    );
  }

  return normalized;
}

function buildFileMetadata(content: string, source?: string): RenderedHarnessFileMetadata {
  const metadata: RenderedHarnessFileMetadata = {
    byteLength: Buffer.byteLength(content, "utf-8"),
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    lineCount: content.length === 0 ? 0 : content.split("\n").length,
  };

  if (source !== undefined) {
    metadata.source = source;
  }

  return metadata;
}

export function createRenderedHarness(
  entries: Iterable<RenderedHarnessEntry>,
  metadata: Omit<RenderedHarnessMetadata, "schemaVersion"> = {},
): RenderedHarness {
  const files = new Map<string, RenderedHarnessFile>();

  for (const entry of entries) {
    const sanitizedPath = sanitizeRenderedHarnessPath(entry.path);
    if (files.has(sanitizedPath)) {
      throw new InvalidRenderedHarnessPathError(
        entry.path,
        "duplicates an existing normalized path",
      );
    }

    files.set(sanitizedPath, {
      path: sanitizedPath,
      content: entry.content,
      metadata: buildFileMetadata(entry.content, entry.source),
    });
  }

  const sortedFiles = new Map(
    [...files.entries()].sort(([left], [right]) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    }),
  );

  return {
    metadata: {
      schemaVersion: 1,
      ...metadata,
    },
    files: sortedFiles,
  };
}

export function renderedHarnessContentMap(rendered: RenderedHarness): Map<string, string> {
  return new Map(
    [...rendered.files].map(([filePath, file]) => [filePath, file.content]),
  );
}

export async function writeRenderedHarness(
  rendered: RenderedHarness,
  targetDir: string,
): Promise<string[]> {
  const root = path.resolve(targetDir);
  const written: string[] = [];

  for (const file of rendered.files.values()) {
    const fullPath = path.resolve(root, file.path);
    if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
      throw new InvalidRenderedHarnessPathError(
        file.path,
        "resolved path escapes the target root",
      );
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file.content, "utf-8");
    written.push(file.path);
  }

  return written;
}
