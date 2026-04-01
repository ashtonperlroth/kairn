import { Command } from "commander";
import { confirm, input, password, select } from "@inquirer/prompts";
import chalk from "chalk";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { execFileSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, saveConfig, getConfigPath, getTemplatesDir } from "../config.js";
import type { KairnConfig, LLMProvider, AuthType } from "../types.js";
import { getAccessToken } from "../auth/keychain.js";
import { PROVIDER_CONFIGS, PROVIDER_MODELS, PROVIDER_CHOICES, getProviderName, getBaseURL, getVerifyModel } from "../providers.js";
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

async function verifyKey(
  provider: LLMProvider,
  apiKey: string,
  baseURL?: string,
  model?: string,
): Promise<boolean> {
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: getVerifyModel(provider, model || "claude-haiku-4-5-20251001"),
        max_tokens: 10,
        messages: [{ role: "user", content: "ping" }],
      });
      return true;
    }

    // All other providers use OpenAI-compatible API
    const verifyModel = provider === "other"
      ? (model || "test")
      : getVerifyModel(provider, model || "");
    const resolvedBaseURL = getBaseURL(provider, baseURL);

    const clientOptions: { apiKey: string; baseURL?: string } = { apiKey };
    if (resolvedBaseURL) clientOptions.baseURL = resolvedBaseURL;

    const client = new OpenAI(clientOptions);
    await client.chat.completions.create({
      model: verifyModel,
      max_tokens: 10,
      messages: [{ role: "user", content: "ping" }],
    });
    return true;
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
      choices: PROVIDER_CHOICES,
    });

    let model: string;
    let baseURL: string | undefined;
    let providerDisplayName: string;

    if (provider === "other") {
      // Custom OpenAI-compatible endpoint
      providerDisplayName = "Custom endpoint";
      baseURL = await input({ message: "Base URL" });
      model = await input({ message: "Model name" });
    } else {
      providerDisplayName = getProviderName(provider);
      model = await select({
        message: "Compilation model",
        choices: PROVIDER_MODELS[provider],
      });
    }

    // For Anthropic: offer Claude Code subscription auth as an alternative
    let apiKey = "";
    let authType: AuthType = "api-key";

    if (provider === "anthropic") {
      const oauthToken = await getAccessToken();
      if (oauthToken) {
        const useOAuth = await confirm({
          message: "Claude Code subscription detected. Use it instead of an API key? (experimental — may break)",
          default: true,
        });
        if (useOAuth) {
          authType = "claude-code-oauth";
          console.log(ui.warn("Using Claude Code OAuth token. This is undocumented and may break at any time."));
          console.log(ui.success("OAuth token validated"));
        }
      }
    }

    if (authType === "api-key") {
      apiKey = await password({
        message: `${providerDisplayName} API key${provider === "other" ? " (Enter to skip)" : ""}`,
        mask: "*",
      });

      if (!apiKey && provider !== "other") {
        console.log(ui.error("No API key provided. Aborting."));
        process.exit(1);
      }

      if (apiKey) {
        console.log(chalk.dim("\n  Verifying API key..."));
        const valid = await verifyKey(provider, apiKey, baseURL, model);

        if (!valid) {
          console.log(ui.error("Invalid API key. Check your key and try again."));
          process.exit(1);
        }

        console.log(ui.success("API key verified"));
      } else {
        console.log(ui.warn("No API key — skipping verification"));
      }
    }

    const config: KairnConfig = {
      provider,
      api_key: apiKey,
      model,
      ...(baseURL ? { base_url: baseURL } : {}),
      ...(authType !== "api-key" ? { auth_type: authType } : {}),
      default_runtime: "claude-code",
      created_at: new Date().toISOString(),
    };

    await saveConfig(config);
    console.log(ui.success(`Config saved to ${chalk.dim(getConfigPath())}`));
    console.log(ui.kv("Provider", providerDisplayName));
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
