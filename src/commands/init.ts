import { Command } from "commander";
import { password, select } from "@inquirer/prompts";
import chalk from "chalk";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { execFileSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, saveConfig, getConfigPath, getTemplatesDir } from "../config.js";
import type { KairnConfig, LLMProvider } from "../types.js";
import { ui } from "../ui.js";
import { printFullBanner } from "../logo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function installSeedTemplates(): Promise<void> {
  const templatesDir = getTemplatesDir();
  await fs.mkdir(templatesDir, { recursive: true });

  const candidates = [
    path.resolve(__dirname, "../registry/templates"),
    path.resolve(__dirname, "../src/registry/templates"),
    path.resolve(__dirname, "../../src/registry/templates"),
  ];

  let seedDir: string | null = null;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      seedDir = candidate;
      break;
    } catch {
      continue;
    }
  }

  if (!seedDir) return;

  const files = (await fs.readdir(seedDir)).filter((f) => f.endsWith(".json"));
  let installed = 0;

  for (const file of files) {
    const dest = path.join(templatesDir, file);
    try {
      await fs.access(dest);
      // File already exists — don't overwrite user modifications
    } catch {
      await fs.copyFile(path.join(seedDir, file), dest);
      installed++;
    }
  }

  if (installed > 0) {
    console.log(ui.success(`${installed} template${installed === 1 ? "" : "s"} installed`));
  }
}

const PROVIDER_MODELS: Record<LLMProvider, { name: string; models: { name: string; value: string }[] }> = {
  anthropic: {
    name: "Anthropic",
    models: [
      { name: "Claude Sonnet 4.6 (recommended — fast, smart)", value: "claude-sonnet-4-6" },
      { name: "Claude Opus 4.6 (highest quality)", value: "claude-opus-4-6" },
      { name: "Claude Haiku 4.5 (fastest, cheapest)", value: "claude-haiku-4-5-20251001" },
    ],
  },
  openai: {
    name: "OpenAI",
    models: [
      { name: "GPT-4o (recommended)", value: "gpt-4o" },
      { name: "GPT-4o mini (faster, cheaper)", value: "gpt-4o-mini" },
      { name: "o3 (reasoning)", value: "o3" },
    ],
  },
  google: {
    name: "Google Gemini",
    models: [
      { name: "Gemini 2.5 Flash (recommended)", value: "gemini-2.5-flash-preview-05-20" },
      { name: "Gemini 2.5 Pro (highest quality)", value: "gemini-2.5-pro-preview-05-06" },
    ],
  },
};

async function verifyKey(provider: LLMProvider, apiKey: string, model: string): Promise<boolean> {
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 10,
        messages: [{ role: "user", content: "ping" }],
      });
      return true;
    } else if (provider === "openai") {
      const client = new OpenAI({ apiKey });
      await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 10,
        messages: [{ role: "user", content: "ping" }],
      });
      return true;
    } else if (provider === "google") {
      // Google uses OpenAI-compatible API
      const client = new OpenAI({
        apiKey,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      });
      await client.chat.completions.create({
        model: "gemini-2.5-flash-preview-05-20",
        max_tokens: 10,
        messages: [{ role: "user", content: "ping" }],
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function detectClaudeCode(): boolean {
  try {
    execFileSync("which", ["claude"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export const initCommand = new Command("init")
  .description("Set up Kairn with your API key")
  .action(async () => {
    printFullBanner("Setup");

    const existing = await loadConfig();
    if (existing) {
      console.log(ui.warn(`Config already exists at ${chalk.dim(getConfigPath())}`));
      console.log(ui.warn("Running setup will overwrite it.\n"));
    }

    const provider = await select<LLMProvider>({
      message: "LLM provider",
      choices: [
        { name: "Anthropic (Claude) — recommended", value: "anthropic" as LLMProvider },
        { name: "OpenAI (GPT)", value: "openai" as LLMProvider },
        { name: "Google (Gemini)", value: "google" as LLMProvider },
      ],
    });

    const providerInfo = PROVIDER_MODELS[provider];

    const model = await select({
      message: "Compilation model",
      choices: providerInfo.models,
    });

    const apiKey = await password({
      message: `${providerInfo.name} API key`,
      mask: "*",
    });

    if (!apiKey) {
      console.log(ui.error("No API key provided. Aborting."));
      process.exit(1);
    }

    console.log(chalk.dim("\n  Verifying API key..."));
    const valid = await verifyKey(provider, apiKey, model);

    if (!valid) {
      console.log(ui.error("Invalid API key. Check your key and try again."));
      process.exit(1);
    }

    console.log(ui.success("API key verified"));

    const config: KairnConfig = {
      provider,
      api_key: apiKey,
      model,
      default_runtime: "claude-code",
      created_at: new Date().toISOString(),
    };

    await saveConfig(config);
    console.log(ui.success(`Config saved to ${chalk.dim(getConfigPath())}`));
    console.log(ui.kv("Provider", providerInfo.name));
    console.log(ui.kv("Model", model));

    await installSeedTemplates();

    const hasClaude = detectClaudeCode();
    if (hasClaude) {
      console.log(ui.success("Claude Code detected"));
    } else {
      console.log(
        ui.warn("Claude Code not found. Install it: npm install -g @anthropic-ai/claude-code")
      );
    }

    console.log(
      "\n" + ui.success(`Ready! Run ${chalk.bold("kairn describe")} to create your first environment.`) + "\n"
    );
  });
