import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getProviderName, getBaseURL } from "./providers.js";
import { getAccessToken } from "./auth/keychain.js";
import { TruncationError } from "./compiler/agents/types.js";
import type { KairnConfig } from "./types.js";

/**
 * Classify an API error into a user-friendly, actionable message.
 *
 * Inspects the error's `status`, `code`, and message text to produce
 * guidance specific to the provider (e.g. "Run `kairn init` to reconfigure").
 */
export function classifyError(err: unknown, provider: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: string })?.code;

  // Network errors
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
    return `Network error: could not reach ${provider} API. Check your internet connection.`;
  }

  // Auth errors
  if (status === 401 || (msg.includes("invalid") && msg.includes("key"))) {
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

/**
 * Call an LLM provider with a user message and system prompt.
 *
 * Routes to the Anthropic SDK for `anthropic` provider, and to the
 * OpenAI-compatible SDK for all other providers.
 *
 * @param config - Kairn configuration with provider, API key, and model
 * @param userMessage - The user message to send
 * @param options - Must include `systemPrompt`; `maxTokens` defaults to 8192;
 *   `agentName` is used in TruncationError if the response is truncated
 * @returns The text response from the LLM
 * @throws {TruncationError} When the response is cut short by the token limit
 */
export async function callLLM(
  config: KairnConfig,
  userMessage: string,
  options: { maxTokens?: number; systemPrompt: string; jsonMode?: boolean; cacheControl?: boolean; agentName?: string }
): Promise<string> {
  const maxTokens = options.maxTokens ?? 8192;
  const { systemPrompt } = options;
  const jsonMode = options.jsonMode ?? false;
  const cacheControl = options.cacheControl ?? false;
  const providerName = getProviderName(config.provider);

  // Resolve API key — use OAuth token from keychain if configured
  let apiKey = config.api_key;
  if (config.auth_type === 'claude-code-oauth') {
    const oauthToken = await getAccessToken();
    if (!oauthToken) {
      throw new Error(
        'Claude Code OAuth token unavailable or expired. Run `kairn init` to reconfigure, or launch Claude Code to refresh the token.'
      );
    }
    apiKey = oauthToken;
  }

  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey });

    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: userMessage },
    ];

    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: maxTokens,
        system: cacheControl
          ? [{ type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }]
          : systemPrompt,
        messages,
      });

      if (response.stop_reason === "max_tokens") {
        const agentLabel = options.agentName ?? "unknown";
        throw new TruncationError(
          `Response truncated at ${maxTokens} tokens. Agent: ${agentLabel}`,
          { agentName: agentLabel, tokensUsed: maxTokens },
        );
      }

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text response from compiler LLM");
      }
      return textBlock.text;
    } catch (err) {
      if (err instanceof TruncationError) {
        throw err;
      }
      throw new Error(classifyError(err, providerName));
    }
  }

  // All other providers use OpenAI-compatible API
  const resolvedBaseURL = getBaseURL(config.provider, config.base_url);
  const clientOptions: { apiKey: string; baseURL?: string } = { apiKey };
  if (resolvedBaseURL) clientOptions.baseURL = resolvedBaseURL;

  const client = new OpenAI(clientOptions);
  try {
    const response = await client.chat.completions.create({
      model: config.model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
    });

    if (response.choices[0]?.finish_reason === "length") {
      const agentLabel = options.agentName ?? "unknown";
      throw new TruncationError(
        `Response truncated at ${maxTokens} tokens. Agent: ${agentLabel}`,
        { agentName: agentLabel, tokensUsed: maxTokens },
      );
    }

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error("No text response from compiler LLM");
    }
    return text;
  } catch (err) {
    if (err instanceof TruncationError) {
      throw err;
    }
    throw new Error(classifyError(err, providerName));
  }
}
