import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { loadConfig, getEnvsDir, ensureDirs } from "../config.js";
import { SYSTEM_PROMPT, CLARIFICATION_PROMPT } from "./prompt.js";
import { loadRegistry } from "../registry/loader.js";
import type { EnvironmentSpec, RegistryTool, KairnConfig, Clarification } from "../types.js";

function buildUserMessage(intent: string, registry: RegistryTool[]): string {
  const registrySummary = registry
    .map(
      (t) =>
        `- ${t.id} (${t.type}, tier ${t.tier}, auth: ${t.auth}): ${t.description} [best_for: ${t.best_for.join(", ")}]`
    )
    .join("\n");

  return `## User Intent\n\n${intent}\n\n## Available Tool Registry\n\n${registrySummary}\n\nGenerate the EnvironmentSpec JSON now.`;
}

function parseSpecResponse(text: string): Omit<EnvironmentSpec, "id" | "intent" | "created_at"> {
  let cleaned = text.trim();
  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  // Try to extract JSON if there's surrounding text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      "LLM response did not contain valid JSON. Try again or use a different model."
    );
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(
      `Failed to parse LLM response as JSON: ${err instanceof Error ? err.message : String(err)}\n` +
      `Response started with: ${cleaned.slice(0, 200)}...`
    );
  }
}

function classifyError(err: unknown, provider: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: string })?.code;

  // Network errors
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
    return `Network error: could not reach ${provider} API. Check your internet connection.`;
  }

  // Auth errors
  if (status === 401 || msg.includes("invalid") && msg.includes("key")) {
    return `Invalid API key for ${provider}. Run \`kairn init\` to reconfigure.`;
  }
  if (status === 403) {
    return `Access denied by ${provider}. Your API key may lack permissions for this model.`;
  }

  // Rate limiting
  if (status === 429 || msg.includes("rate limit") || msg.includes("quota")) {
    return `Rate limited by ${provider}. Wait a moment and try again, or switch to a cheaper model with \`kairn init\`.`;
  }

  // Model errors
  if (status === 404 || msg.includes("not found") || msg.includes("does not exist")) {
    return `Model not found on ${provider}. Run \`kairn init\` to select a valid model.`;
  }

  // Overloaded
  if (status === 529 || status === 503 || msg.includes("overloaded")) {
    return `${provider} is temporarily overloaded. Try again in a few seconds.`;
  }

  // Token/context limit
  if (msg.includes("token") && (msg.includes("limit") || msg.includes("exceed"))) {
    return `Request too large for the selected model. Try a shorter workflow description.`;
  }

  // Billing
  if (msg.includes("billing") || msg.includes("payment") || msg.includes("insufficient")) {
    return `Billing issue with your ${provider} account. Check your account dashboard.`;
  }

  // Fallback
  return `${provider} API error: ${msg}`;
}

async function callLLM(config: KairnConfig, userMessage: string): Promise<string> {
  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.api_key });
    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });
      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text response from compiler LLM");
      }
      return textBlock.text;
    } catch (err) {
      throw new Error(classifyError(err, "Anthropic"));
    }
  } else if (config.provider === "openai" || config.provider === "google") {
    const providerName = config.provider === "google" ? "Google" : "OpenAI";
    const clientOptions: { apiKey: string; baseURL?: string } = { apiKey: config.api_key };
    if (config.provider === "google") {
      clientOptions.baseURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
    }
    const client = new OpenAI(clientOptions);
    try {
      const response = await client.chat.completions.create({
        model: config.model,
        max_tokens: 8192,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      });
      const text = response.choices[0]?.message?.content;
      if (!text) {
        throw new Error("No text response from compiler LLM");
      }
      return text;
    } catch (err) {
      throw new Error(classifyError(err, providerName));
    }
  }
  throw new Error(`Unsupported provider: ${config.provider}. Run \`kairn init\` to reconfigure.`);
}

function validateSpec(spec: EnvironmentSpec, onProgress?: (msg: string) => void): void {
  const warnings: string[] = [];

  if (spec.tools.length > 8) {
    warnings.push(`${spec.tools.length} MCP servers selected (recommended: ≤6)`);
  }

  if (spec.harness.claude_md) {
    const lines = spec.harness.claude_md.split('\n').length;
    if (lines > 150) {
      warnings.push(`CLAUDE.md is ${lines} lines (recommended: ≤100)`);
    }
  }

  if (spec.harness.skills && Object.keys(spec.harness.skills).length > 5) {
    warnings.push(`${Object.keys(spec.harness.skills).length} skills (recommended: ≤3)`);
  }

  for (const warning of warnings) {
    onProgress?.(`⚠ ${warning}`);
  }
}

export async function compile(
  intent: string,
  onProgress?: (msg: string) => void
): Promise<EnvironmentSpec> {
  const config = await loadConfig();
  if (!config) {
    throw new Error("No config found. Run `kairn init` first.");
  }

  onProgress?.("Loading tool registry...");
  const registry = await loadRegistry();

  onProgress?.(`Compiling with ${config.provider} (${config.model})...`);
  const userMessage = buildUserMessage(intent, registry);
  const responseText = await callLLM(config, userMessage);

  onProgress?.("Parsing environment spec...");
  const parsed = parseSpecResponse(responseText);

  const spec: EnvironmentSpec = {
    id: `env_${crypto.randomUUID()}`,
    intent,
    created_at: new Date().toISOString(),
    ...parsed,
  };

  validateSpec(spec, onProgress);

  // Save to ~/.kairn/envs/
  await ensureDirs();
  const envPath = path.join(getEnvsDir(), `${spec.id}.json`);
  await fs.writeFile(envPath, JSON.stringify(spec, null, 2), "utf-8");

  return spec;
}

export async function generateClarifications(
  intent: string,
  onProgress?: (msg: string) => void
): Promise<Clarification[]> {
  const config = await loadConfig();
  if (!config) {
    throw new Error("No config found. Run `kairn init` first.");
  }

  onProgress?.("Analyzing your request...");

  // Use a fast model for clarifications
  const clarificationConfig = { ...config };
  if (config.provider === "anthropic") {
    clarificationConfig.model = "claude-haiku-4-5-20251001";
  }

  const response = await callLLM(clarificationConfig, CLARIFICATION_PROMPT + "\n\nUser description: " + intent);

  try {
    let cleaned = response.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as Clarification[];
  } catch {
    return [];
  }
}
