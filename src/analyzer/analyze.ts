/**
 * Core semantic analyzer — analyzes a project's codebase via LLM to produce
 * a structured ProjectAnalysis describing its purpose, architecture, modules,
 * workflows, and data flow.
 *
 * Uses repomix to pack sampled source files and sends them to an LLM for
 * semantic understanding. Results are cached on disk and reused when the
 * sampled files haven't changed.
 */

import type {
  ProjectAnalysis,
  AnalysisResult,
  AnalysisModule,
  AnalysisWorkflow,
  DataflowEdge,
  ConfigKey,
} from './types.js';
import { AnalysisError } from './types.js';
import { getStrategy, getAlwaysInclude, classifyFilePriority, resolveStrategy, mergeStrategies } from './patterns.js';
import type { SamplingStrategy } from './patterns.js';
import { packCodebase } from './repomix-adapter.js';
import {
  readCache,
  writeCache,
  computeContentHash,
  isCacheValid,
} from './cache.js';
import { callLLM } from '../llm.js';
import type { ProjectProfile } from '../scanner/scan.js';
import type { KairnConfig } from '../types.js';

// --- LLM output shape validators ---
// These guard against malformed LLM responses that pass Array.isArray but
// have wrong element shapes. Invalid elements are silently dropped.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isModule(v: unknown): v is AnalysisModule {
  return isRecord(v) && typeof v.name === 'string' && typeof v.path === 'string';
}

function isWorkflow(v: unknown): v is AnalysisWorkflow {
  return isRecord(v) && typeof v.name === 'string' && typeof v.trigger === 'string';
}

function isDataflowEdge(v: unknown): v is DataflowEdge {
  return isRecord(v) && typeof v.from === 'string' && typeof v.to === 'string';
}

function isConfigKey(v: unknown): v is ConfigKey {
  return isRecord(v) && typeof v.name === 'string' && typeof v.purpose === 'string';
}

function validateArray<T>(raw: unknown, guard: (v: unknown) => v is T): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(guard);
}

/**
 * System prompt for the analysis LLM call.
 *
 * Instructs the model to produce a structured JSON analysis of the codebase
 * with specific, grounded observations (no hallucination).
 */
const ANALYSIS_SYSTEM_PROMPT = `You are analyzing a codebase to understand its purpose, architecture, and key workflows.

You will receive sampled source files from the project. Produce a JSON analysis.

## Rules
- Be SPECIFIC. Don't say "data processing" — say "Bayesian posterior estimation via SBI".
- Don't list generic modules — list the domain-specific ones that define THIS project.
- Every field must reflect what you actually see in the code. If unsure, say "unknown".
- Do NOT hallucinate files, functions, or modules that aren't in the samples.

## Output Format
Return a single JSON object (no markdown fences, no explanation):
{
  "purpose": "one-line project goal",
  "domain": "category",
  "key_modules": [{ "name": "...", "path": "...", "description": "...", "responsibilities": ["..."] }],
  "workflows": [{ "name": "...", "description": "...", "trigger": "...", "steps": ["..."] }],
  "architecture_style": "monolithic | microservice | serverless | CLI | library | plugin",
  "deployment_model": "local | containerized | serverless | hybrid",
  "dataflow": [{ "from": "module_a", "to": "module_b", "data": "what flows between them" }],
  "config_keys": [{ "name": "ENV_VAR_NAME", "purpose": "what it configures" }]
}`;

/**
 * Analyze a project directory using semantic codebase understanding.
 *
 * Samples source files using language-specific strategies (one per detected
 * language), merges them into a single unified strategy, packs the codebase
 * with repomix, and sends to an LLM for structured analysis. The result is
 * cached on disk and reused when the sampled files haven't changed.
 *
 * @param dir - Absolute path to the project directory.
 * @param profile - Pre-scanned project profile from the scanner.
 * @param config - Kairn configuration with provider/model/API key.
 * @param options - Optional flags: `refresh` forces re-analysis even if cache is valid.
 * @returns An AnalysisResult containing both the structured ProjectAnalysis
 *   and the raw packed source code from Repomix sampling.
 * @throws {AnalysisError} With type `no_entry_point` if no sampling strategy exists for any of the detected languages.
 * @throws {AnalysisError} With type `empty_sample` if no source files are found.
 * @throws {AnalysisError} With type `llm_parse_failure` if the LLM response is not valid JSON or missing required fields.
 */
/** Default token budget for codebase sampling. 60K tokens covers ~30-40% of a
 *  medium codebase, but with priority-tiered sampling the most important files
 *  (entry points, config, core domain) are guaranteed to be included. Costs
 *  ~$0.18 on Sonnet, cached after first run. */
const DEFAULT_TOKEN_BUDGET = 60_000;

export async function analyzeProject(
  dir: string,
  profile: ProjectProfile,
  config: KairnConfig,
  options?: { refresh?: boolean; tokenBudget?: number },
): Promise<AnalysisResult> {
  // 1. Check cache (unless refresh is forced)
  if (!options?.refresh) {
    const cache = await readCache(dir);
    if (cache) {
      const currentHash = await computeContentHash(
        cache.analysis.sampled_files,
        dir,
      );
      if (isCacheValid(cache, currentHash)) {
        return {
          analysis: cache.analysis,
          packedSource: cache.packedSource ?? '',
        };
      }
    }
  }

  // 2. Get strategies for all detected languages, resolve each, then merge
  const strategies = profile.languages
    .map(lang => getStrategy(lang))
    .filter((s): s is SamplingStrategy => s !== null);

  if (strategies.length === 0) {
    throw new AnalysisError(
      `No sampling strategy for languages: ${profile.languages.join(', ') || 'none detected'}`,
      'no_entry_point',
      'Supported: Python, TypeScript, Go, Rust',
    );
  }

  const resolved = await Promise.all(
    strategies.map(s => resolveStrategy(dir, s, profile.framework, profile.scripts)),
  );
  const strategy = mergeStrategies(resolved);

  // 3. Build include patterns from enriched strategy
  const include = [
    ...strategy.entryPoints,
    ...strategy.domainPatterns.map((p) => p + '**/*'),
    ...strategy.configPatterns,
    ...getAlwaysInclude(),
  ];

  // 4. Pack codebase with repomix (priority-tiered truncation)
  const packed = await packCodebase(dir, {
    include,
    exclude: strategy.excludePatterns,
    maxTokens: options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
    prioritize: (filePath: string) => classifyFilePriority(filePath, strategy),
  });

  // 5. Guard: empty sample
  if (packed.fileCount === 0) {
    throw new AnalysisError(
      'No source files found',
      'empty_sample',
      `Repomix returned 0 files for ${strategy.language} patterns`,
    );
  }

  // 6. Call LLM for semantic analysis
  const userMessage = buildUserMessage(strategy.language, profile, packed.content);

  const rawResponse = await callLLM(config, userMessage, {
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    jsonMode: true,
    maxTokens: 4096,
    agentName: 'analyzer',
  });

  // 7. Parse the response
  const parsed = parseResponse(rawResponse);

  // 8. Validate required fields
  if (
    typeof parsed.purpose !== 'string' ||
    typeof parsed.domain !== 'string'
  ) {
    throw new AnalysisError(
      'LLM response missing required fields (purpose, domain)',
      'llm_parse_failure',
      JSON.stringify(Object.keys(parsed)),
    );
  }

  // 9. Compute content hash from the sampled files
  const contentHash = await computeContentHash(packed.filePaths, dir);

  // 10. Build the ProjectAnalysis with shape validation on array elements
  const analysis: ProjectAnalysis = {
    purpose: parsed.purpose as string,
    domain: parsed.domain as string,
    key_modules: validateArray(parsed.key_modules, isModule),
    workflows: validateArray(parsed.workflows, isWorkflow),
    architecture_style:
      (parsed.architecture_style as string) ?? 'unknown',
    deployment_model:
      (parsed.deployment_model as string) ?? 'unknown',
    dataflow: validateArray(parsed.dataflow, isDataflowEdge),
    config_keys: validateArray(parsed.config_keys, isConfigKey),
    sampled_files: packed.filePaths,
    content_hash: contentHash,
    analyzed_at: new Date().toISOString(),
  };

  // 11. Write cache (including packed source) and return
  await writeCache(dir, analysis, packed.content);
  return { analysis, packedSource: packed.content };
}

/**
 * Build the user message sent to the LLM for analysis.
 *
 * Includes project metadata, truncated dependency list, and packed source code.
 */
function buildUserMessage(
  language: string,
  profile: ProjectProfile,
  packedContent: string,
): string {
  return [
    `Analyze this ${language} project:`,
    '',
    `Project: ${profile.name}`,
    `Description: ${profile.description || 'none'}`,
    `Framework: ${profile.framework || 'none'}`,
    `Dependencies: ${profile.dependencies.slice(0, 20).join(', ')}`,
    '',
    '## Sampled Source Code',
    '',
    packedContent,
  ].join('\n');
}

/**
 * Parse raw LLM response into a Record, stripping markdown code fences if present.
 *
 * @throws {AnalysisError} With type `llm_parse_failure` if JSON parsing fails.
 */
function parseResponse(rawResponse: string): Record<string, unknown> {
  try {
    const cleaned = rawResponse
      .replace(/^```(?:json)?\s*\n?/m, '')
      .replace(/\n?```\s*$/m, '');
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new AnalysisError(
      'Failed to parse LLM analysis response',
      'llm_parse_failure',
      rawResponse.slice(0, 200),
    );
  }
}
