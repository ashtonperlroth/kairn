import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyError, callLLM } from "../llm.js";
import { TruncationError } from "../compiler/agents/types.js";
import type { KairnConfig } from "../types.js";

const anthropicCreateMock = vi.fn();
const openaiCreateMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages: { create: ReturnType<typeof vi.fn> };
      constructor() {
        this.messages = { create: anthropicCreateMock };
      }
    },
  };
});

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat: { completions: { create: ReturnType<typeof vi.fn> } };
      constructor() {
        this.chat = { completions: { create: openaiCreateMock } };
      }
    },
  };
});

function makeConfig(overrides: Partial<KairnConfig> = {}): KairnConfig {
  return {
    provider: "anthropic",
    api_key: "test-key",
    model: "claude-sonnet-4-6",
    default_runtime: "claude-code",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("classifyError", () => {
  it("classifies network connection refused errors", () => {
    const err = Object.assign(new Error("connection failed"), { code: "ECONNREFUSED" });
    const result = classifyError(err, "Anthropic");
    expect(result).toContain("Network error");
    expect(result).toContain("Anthropic");
  });

  it("classifies network not found errors", () => {
    const err = Object.assign(new Error("host not found"), { code: "ENOTFOUND" });
    const result = classifyError(err, "OpenAI");
    expect(result).toContain("Network error");
    expect(result).toContain("OpenAI");
  });

  it("classifies network timeout errors", () => {
    const err = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    const result = classifyError(err, "Google");
    expect(result).toContain("Network error");
    expect(result).toContain("Google");
  });

  it("classifies 401 authentication errors", () => {
    const err = Object.assign(new Error("unauthorized"), { status: 401 });
    const result = classifyError(err, "Anthropic");
    expect(result).toContain("Invalid API key");
    expect(result).toContain("kairn init");
  });

  it("classifies invalid key message errors", () => {
    const err = new Error("invalid api key provided");
    const result = classifyError(err, "OpenAI");
    expect(result).toContain("Invalid API key");
  });

  it("classifies 403 permission errors", () => {
    const err = Object.assign(new Error("forbidden"), { status: 403 });
    const result = classifyError(err, "Anthropic");
    expect(result).toContain("Access denied");
    expect(result).toContain("permissions");
  });

  it("classifies 429 rate limit errors", () => {
    const err = Object.assign(new Error("too many requests"), { status: 429 });
    const result = classifyError(err, "OpenAI");
    expect(result).toContain("Rate limited");
  });

  it("classifies rate limit message errors", () => {
    const err = new Error("rate limit exceeded");
    const result = classifyError(err, "Anthropic");
    expect(result).toContain("Rate limited");
  });

  it("classifies quota exceeded errors", () => {
    const err = new Error("quota exceeded");
    const result = classifyError(err, "OpenAI");
    expect(result).toContain("Rate limited");
  });

  it("classifies 404 model not found errors", () => {
    const err = Object.assign(new Error("model not found"), { status: 404 });
    const result = classifyError(err, "Anthropic");
    expect(result).toContain("Model not found");
    expect(result).toContain("kairn init");
  });

  it("classifies model does not exist errors", () => {
    const err = new Error("model does not exist");
    const result = classifyError(err, "OpenAI");
    expect(result).toContain("Model not found");
  });

  it("classifies 529 overloaded errors", () => {
    const err = Object.assign(new Error("overloaded"), { status: 529 });
    const result = classifyError(err, "Anthropic");
    expect(result).toContain("overloaded");
  });

  it("classifies 503 service unavailable errors", () => {
    const err = Object.assign(new Error("service unavailable"), { status: 503 });
    const result = classifyError(err, "Google");
    expect(result).toContain("overloaded");
  });

  it("classifies token limit errors", () => {
    const err = new Error("token limit exceeded");
    const result = classifyError(err, "Anthropic");
    expect(result).toContain("too large");
  });

  it("classifies billing errors", () => {
    const err = new Error("billing issue on account");
    const result = classifyError(err, "OpenAI");
    expect(result).toContain("Billing issue");
    expect(result).toContain("OpenAI");
  });

  it("classifies payment errors", () => {
    const err = new Error("payment required");
    const result = classifyError(err, "Anthropic");
    expect(result).toContain("Billing issue");
  });

  it("returns fallback for unknown errors", () => {
    const err = new Error("something completely unexpected");
    const result = classifyError(err, "CustomProvider");
    expect(result).toContain("CustomProvider");
    expect(result).toContain("something completely unexpected");
  });

  it("handles non-Error objects", () => {
    const result = classifyError("string error", "Anthropic");
    expect(result).toContain("string error");
  });
});

describe("callLLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires systemPrompt in options and passes it to the API", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "response text" }],
    });

    const config = makeConfig();
    const result = await callLLM(config, "hello", { systemPrompt: "be helpful" });

    expect(result).toBe("response text");
    expect(anthropicCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "be helpful",
      })
    );
  });

  it("calls Anthropic SDK for anthropic provider", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "anthropic response" }],
    });

    const config = makeConfig({ provider: "anthropic" });
    const result = await callLLM(config, "test message", {
      systemPrompt: "system prompt",
      maxTokens: 4096,
    });

    expect(result).toBe("anthropic response");
    expect(anthropicCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: "system prompt",
        messages: [{ role: "user", content: "test message" }],
      })
    );
  });

  it("calls OpenAI SDK for non-anthropic providers", async () => {
    openaiCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: "openai response" } }],
    });

    const config = makeConfig({ provider: "openai", model: "gpt-4.1" });
    const result = await callLLM(config, "test message", {
      systemPrompt: "system prompt",
    });

    expect(result).toBe("openai response");
    expect(openaiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: "system prompt" },
          { role: "user", content: "test message" },
        ],
      })
    );
  });

  it("defaults maxTokens to 8192", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });

    const config = makeConfig();
    await callLLM(config, "test", { systemPrompt: "prompt" });

    expect(anthropicCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 8192,
      })
    );
  });

  it("throws classified error on Anthropic API failure", async () => {
    const apiError = Object.assign(new Error("unauthorized"), { status: 401 });
    anthropicCreateMock.mockRejectedValueOnce(apiError);

    const config = makeConfig();
    await expect(
      callLLM(config, "test", { systemPrompt: "prompt" })
    ).rejects.toThrow("Invalid API key");
  });

  it("throws classified error on OpenAI API failure", async () => {
    const apiError = Object.assign(new Error("rate limit exceeded"), { status: 429 });
    openaiCreateMock.mockRejectedValueOnce(apiError);

    const config = makeConfig({ provider: "openai", model: "gpt-4.1" });
    await expect(
      callLLM(config, "test", { systemPrompt: "prompt" })
    ).rejects.toThrow("Rate limited");
  });

  it("throws error when Anthropic returns no text block", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [],
    });

    const config = makeConfig();
    await expect(
      callLLM(config, "test", { systemPrompt: "prompt" })
    ).rejects.toThrow("No text response");
  });

  it("throws error when OpenAI returns no content", async () => {
    openaiCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const config = makeConfig({ provider: "openai", model: "gpt-4.1" });
    await expect(
      callLLM(config, "test", { systemPrompt: "prompt" })
    ).rejects.toThrow("No text response");
  });

  it("does not use assistant prefill for Anthropic even when jsonMode is true", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"reasoning": "analysis", "mutations": []}' }],
    });

    const config = makeConfig({ provider: "anthropic" });
    const result = await callLLM(config, "test", {
      systemPrompt: "prompt",
      jsonMode: true,
    });

    expect(result).toBe('{"reasoning": "analysis", "mutations": []}');
    expect(anthropicCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "test" }],
      })
    );
  });

  it("uses response_format for OpenAI when jsonMode is true", async () => {
    openaiCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"result": "ok"}' } }],
    });

    const config = makeConfig({ provider: "openai", model: "gpt-4.1" });
    const result = await callLLM(config, "test", {
      systemPrompt: "prompt",
      jsonMode: true,
    });

    expect(result).toBe('{"result": "ok"}');
    expect(openaiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: "json_object" },
      })
    );
  });

  it("does not use assistant prefill when jsonMode is false (Anthropic)", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "plain text response" }],
    });

    const config = makeConfig({ provider: "anthropic" });
    const result = await callLLM(config, "test", {
      systemPrompt: "prompt",
      jsonMode: false,
    });

    expect(result).toBe("plain text response");
    expect(anthropicCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "test" }],
      })
    );
  });

  it("does not use response_format when jsonMode is false (OpenAI)", async () => {
    openaiCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: "plain openai response" } }],
    });

    const config = makeConfig({ provider: "openai", model: "gpt-4.1" });
    const result = await callLLM(config, "test", {
      systemPrompt: "prompt",
      jsonMode: false,
    });

    expect(result).toBe("plain openai response");
    const callArg = openaiCreateMock.mock.calls[0][0];
    expect(callArg).not.toHaveProperty("response_format");
  });
});

describe("callLLM truncation detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws TruncationError when Anthropic response has stop_reason max_tokens", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"partial": true' }],
      stop_reason: "max_tokens",
    });
    const config = makeConfig();
    await expect(
      callLLM(config, "test", {
        systemPrompt: "test",
        agentName: "sections-writer",
      }),
    ).rejects.toThrow(TruncationError);
  });

  it("TruncationError carries agent name and tokens used", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "partial" }],
      stop_reason: "max_tokens",
    });
    const config = makeConfig();
    try {
      await callLLM(config, "test", {
        systemPrompt: "test",
        maxTokens: 4096,
        agentName: "rule-writer",
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TruncationError);
      expect((err as TruncationError).agentName).toBe("rule-writer");
      expect((err as TruncationError).tokensUsed).toBe(4096);
    }
  });

  it("does not throw TruncationError when Anthropic stop_reason is end_turn", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "complete response" }],
      stop_reason: "end_turn",
    });
    const config = makeConfig();
    const result = await callLLM(config, "test", {
      systemPrompt: "test",
      agentName: "sections-writer",
    });
    expect(result).toBe("complete response");
  });

  it("throws TruncationError when OpenAI finish_reason is length", async () => {
    openaiCreateMock.mockResolvedValueOnce({
      choices: [
        { message: { content: "partial" }, finish_reason: "length" },
      ],
    });
    const config = makeConfig({ provider: "openai", model: "gpt-4.1" });
    await expect(
      callLLM(config, "test", {
        systemPrompt: "test",
        agentName: "command-writer",
      }),
    ).rejects.toThrow(TruncationError);
  });

  it("does not throw TruncationError when OpenAI finish_reason is stop", async () => {
    openaiCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: "complete" }, finish_reason: "stop" }],
    });
    const config = makeConfig({ provider: "openai", model: "gpt-4.1" });
    const result = await callLLM(config, "test", { systemPrompt: "test" });
    expect(result).toBe("complete");
  });

  it("uses 'unknown' as agent name when agentName not provided", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "partial" }],
      stop_reason: "max_tokens",
    });
    const config = makeConfig();
    try {
      await callLLM(config, "test", {
        systemPrompt: "test",
        maxTokens: 2048,
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TruncationError);
      expect((err as TruncationError).agentName).toBe("unknown");
    }
  });

  it("includes agent name in TruncationError message", async () => {
    anthropicCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "partial" }],
      stop_reason: "max_tokens",
    });
    const config = makeConfig();
    try {
      await callLLM(config, "test", {
        systemPrompt: "test",
        agentName: "doc-writer",
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TruncationError);
      expect((err as Error).message).toContain("doc-writer");
    }
  });

  it("OpenAI TruncationError carries correct agent name and tokens", async () => {
    openaiCreateMock.mockResolvedValueOnce({
      choices: [
        { message: { content: "partial" }, finish_reason: "length" },
      ],
    });
    const config = makeConfig({ provider: "openai", model: "gpt-4.1" });
    try {
      await callLLM(config, "test", {
        systemPrompt: "test",
        maxTokens: 16384,
        agentName: "agent-writer",
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TruncationError);
      expect((err as TruncationError).agentName).toBe("agent-writer");
      expect((err as TruncationError).tokensUsed).toBe(16384);
    }
  });
});
