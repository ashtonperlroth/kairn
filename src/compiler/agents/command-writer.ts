/**
 * @command-writer specialist agent.
 *
 * Generates `CommandNode[]` from an `AgentTask` by calling the LLM with a
 * system prompt optimized for Claude Code slash-command generation.
 *
 * Key behaviors:
 * - Always ensures a `help` command exists (injects a default if the LLM omits it)
 * - Batches items into groups of 8 when the task has more than 10 items
 * - Strips code fences and parses JSON from the LLM response
 * - Uses `createCommandNode()` factory for all node construction
 */

import { callLLM } from "../../llm.js";
import { createCommandNode } from "../../ir/types.js";
import type { KairnConfig, SkeletonSpec } from "../../types.js";
import type { CommandNode } from "../../ir/types.js";
import type { AgentTask, AgentResult } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 8;
const BATCH_THRESHOLD = 10;

const DEFAULT_HELP_CONTENT = `Show available /project: commands and their descriptions.

List all slash commands with a brief description of what each does.`;

const DEFAULT_HELP_DESCRIPTION = "Show available commands and their descriptions";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are @command-writer, a specialist agent that generates Claude Code slash commands.

## Output Format
Return a JSON array of command objects. Each object has:
- "name": the command name (no /project: prefix, just the bare name like "build", "test")
- "description": a one-line description of what the command does
- "content": the full command body (markdown text with optional shell integration)

## Shell Integration
Commands can execute shell commands using the ! prefix:
- \`!npm run build\` — runs the command directly
- \`!$ARGUMENTS\` — passes user arguments to a shell command
- Multiple ! lines are run in sequence

## Command Patterns
- **Build/Test**: Direct shell execution with !
- **Workflow**: Multi-step orchestration instructions in natural language
- **Review**: Instructions for Claude to analyze code
- **Deploy**: Safety checks + shell execution

## Example Output
\`\`\`json
[
  {
    "name": "build",
    "description": "Build the project",
    "content": "Run the full build pipeline.\\n\\n!npm run build"
  },
  {
    "name": "test",
    "description": "Run the test suite",
    "content": "Execute all tests and report results.\\n\\n!npm test"
  },
  {
    "name": "review",
    "description": "Review staged changes",
    "content": "Review all staged git changes for:\\n- Code quality issues\\n- Security concerns\\n- Missing tests\\n\\nProvide actionable feedback."
  }
]
\`\`\`

## Rules
- Command names are kebab-case, lowercase
- Content should be actionable and specific to the project
- Include shell commands (!) where appropriate for automation
- Keep descriptions under 80 characters
- Return ONLY the JSON array, no surrounding text`;

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

interface RawCommand {
  name: string;
  description: string;
  content: string;
}

/**
 * Strip code fences and parse a JSON array of command objects from the LLM response.
 */
function parseCommandResponse(text: string): RawCommand[] {
  let cleaned = text.trim();

  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  // Extract the JSON array
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    throw new Error("@command-writer: LLM response did not contain a JSON array.");
  }

  const parsed: unknown = JSON.parse(arrayMatch[0]);

  if (!Array.isArray(parsed)) {
    throw new Error("@command-writer: parsed response is not an array.");
  }

  return parsed.map((item: unknown) => {
    const obj = item as Record<string, unknown>;
    if (typeof obj.name !== "string" || typeof obj.content !== "string") {
      throw new Error("@command-writer: each command must have 'name' and 'content' strings.");
    }
    return {
      name: obj.name,
      description: typeof obj.description === "string" ? obj.description : "",
      content: obj.content,
    };
  });
}

// ---------------------------------------------------------------------------
// User message construction
// ---------------------------------------------------------------------------

function buildUserMessage(
  intent: string,
  skeleton: SkeletonSpec,
  batchItems: string[],
  phaseAContext?: string,
): string {
  const lines: string[] = [];

  lines.push("## Project Context");
  lines.push(`Intent: ${intent}`);
  lines.push(`Tech stack: ${skeleton.outline.tech_stack.join(", ")}`);
  lines.push(`Workflow type: ${skeleton.outline.workflow_type}`);
  lines.push("");

  if (phaseAContext) {
    lines.push("## Reference (from Phase A)");
    lines.push(phaseAContext);
    lines.push("");
  }

  lines.push("## Commands to Generate");
  for (const item of batchItems) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("Generate the JSON array of command objects now.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Batching
// ---------------------------------------------------------------------------

/** Split an array into chunks of a given size. */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Help command injection
// ---------------------------------------------------------------------------

function ensureHelpCommand(commands: CommandNode[]): CommandNode[] {
  const hasHelp = commands.some((c) => c.name === "help");
  if (hasHelp) {
    return commands;
  }
  return [
    ...commands,
    createCommandNode("help", DEFAULT_HELP_CONTENT, DEFAULT_HELP_DESCRIPTION),
  ];
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/** Deduplicate commands by name, keeping the first occurrence. */
function deduplicateCommands(commands: CommandNode[]): CommandNode[] {
  const seen = new Set<string>();
  const result: CommandNode[] = [];
  for (const cmd of commands) {
    if (!seen.has(cmd.name)) {
      seen.add(cmd.name);
      result.push(cmd);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// LLM call + parse helper
// ---------------------------------------------------------------------------

/** Call the LLM for a batch of items and return parsed CommandNode[]. */
async function generateBatch(
  intent: string,
  skeleton: SkeletonSpec,
  batchItems: string[],
  config: KairnConfig,
  maxTokens: number,
  phaseAContext?: string,
): Promise<CommandNode[]> {
  const userMessage = buildUserMessage(intent, skeleton, batchItems, phaseAContext);
  const responseText = await callLLM(config, userMessage, {
    systemPrompt: SYSTEM_PROMPT,
    cacheControl: true,
    maxTokens,
  });
  const rawCommands = parseCommandResponse(responseText);
  return rawCommands.map((c) =>
    createCommandNode(c.name, c.content, c.description),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate `CommandNode[]` via the command-writer specialist agent.
 *
 * Calls the LLM with a command-generation prompt.
 * Batches items into groups of 8 when there are more than 10 items.
 * Always ensures a `help` command is present in the result.
 *
 * @param intent - The user's natural-language project description
 * @param skeleton - The Pass 1 skeleton with tech stack and outline
 * @param task - The agent task containing items (command names) to generate
 * @param config - Kairn config with LLM provider settings
 * @returns An `AgentResult` with `agent: 'command-writer'` and generated commands
 */
export async function generateCommands(
  intent: string,
  skeleton: SkeletonSpec,
  task: AgentTask,
  config: KairnConfig,
): Promise<AgentResult> {
  // Empty items: return immediately without calling LLM
  if (task.items.length === 0) {
    return { agent: "command-writer", commands: [] };
  }

  let allCommands: CommandNode[];

  if (task.items.length > BATCH_THRESHOLD) {
    // Batch mode: split into chunks and call LLM for each
    const batches = chunk(task.items, BATCH_SIZE);
    const batchResults: CommandNode[][] = [];

    for (const batch of batches) {
      const nodes = await generateBatch(intent, skeleton, batch, config, task.max_tokens, task.context_hint);
      batchResults.push(nodes);
    }

    allCommands = deduplicateCommands(batchResults.flat());
  } else {
    // Single call mode
    allCommands = await generateBatch(intent, skeleton, task.items, config, task.max_tokens, task.context_hint);
  }

  // Ensure help command exists
  allCommands = ensureHelpCommand(allCommands);

  return { agent: "command-writer", commands: allCommands };
}
