import type { ChatMessage, Env, ModelConfig, ProviderResponse } from "./types";
import { callOpenAI } from "./providers/openai";
import { callAnthropic } from "./providers/anthropic";
import { callGemini } from "./providers/gemini";
import { callDeepSeek } from "./providers/deepseek";
import { callGroq } from "./providers/groq";

const PROVIDER_TIMEOUT_MS = 3000;

export const MODEL_MAP: Record<string, ModelConfig> = {
  "hormulse-pro": {
    provider: "openai",
    model: "gpt-4o",
    fallbackProvider: "anthropic",
    fallbackModel: "claude-3-5-sonnet-20241022",
    costPer1kIn: 0.005,
    costPer1kOut: 0.015,
  },
  "hormulse-fast": {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o-mini",
    costPer1kIn: 0.00059,
    costPer1kOut: 0.00079,
  },
  "hormulse-reasoning": {
    provider: "deepseek",
    model: "deepseek-reasoner",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o",
    costPer1kIn: 0.00055,
    costPer1kOut: 0.00219,
  },
  "hormulse-vision": {
    provider: "gemini",
    model: "gemini-1.5-pro",
    fallbackProvider: "openai",
    fallbackModel: "gpt-4o",
    costPer1kIn: 0.00125,
    costPer1kOut: 0.005,
  },
};

const DEFAULT_MODEL = "hormulse-fast";

type SupportedProvider = "openai" | "anthropic" | "gemini" | "deepseek" | "groq";

function getApiKey(provider: SupportedProvider, env: Env): string {
  const keyMap: Record<SupportedProvider, string> = {
    openai: env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    gemini: env.GEMINI_API_KEY,
    deepseek: env.DEEPSEEK_API_KEY,
    groq: env.GROQ_API_KEY,
  };
  return keyMap[provider] ?? "";
}

async function callProvider(
  provider: SupportedProvider,
  model: string,
  messages: ChatMessage[],
  apiKey: string,
  stream: boolean,
  temperature: number,
  maxTokens: number,
  timeoutMs: number
): Promise<ProviderResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let result: ProviderResponse;
    switch (provider) {
      case "openai":
        result = await callOpenAI(messages, model, apiKey, stream, temperature, maxTokens, controller.signal);
        break;
      case "anthropic":
        result = await callAnthropic(messages, model, apiKey, stream, temperature, maxTokens, controller.signal);
        break;
      case "gemini":
        result = await callGemini(messages, model, apiKey, stream, temperature, maxTokens, controller.signal);
        break;
      case "deepseek":
        result = await callDeepSeek(messages, model, apiKey, stream, temperature, maxTokens, controller.signal);
        break;
      case "groq":
        result = await callGroq(messages, model, apiKey, stream, temperature, maxTokens, controller.signal);
        break;
    }
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export async function routeChat(
  messages: ChatMessage[],
  modelAlias: string,
  stream: boolean,
  temperature: number,
  maxTokens: number,
  env: Env
): Promise<ProviderResponse> {
  const config = MODEL_MAP[modelAlias] ?? MODEL_MAP[DEFAULT_MODEL];

  const primaryKey = getApiKey(config.provider, env);
  const fallbackKey = getApiKey(config.fallbackProvider, env);

  let lastError: unknown;

  if (primaryKey) {
    try {
      return await callProvider(
        config.provider,
        config.model,
        messages,
        primaryKey,
        stream,
        temperature,
        maxTokens,
        PROVIDER_TIMEOUT_MS
      );
    } catch (err) {
      lastError = err;
    }
  }

  if (fallbackKey) {
    return await callProvider(
      config.fallbackProvider,
      config.fallbackModel,
      messages,
      fallbackKey,
      stream,
      temperature,
      maxTokens,
      PROVIDER_TIMEOUT_MS * 3
    );
  }

  throw lastError ?? new Error("No provider available");
}
