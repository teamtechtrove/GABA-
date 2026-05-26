import type { ChatMessage, ProviderResponse } from "../types";

interface OpenAIResponse {
  choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export async function callOpenAI(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  stream: boolean,
  temperature: number,
  maxTokens: number,
  signal: AbortSignal
): Promise<ProviderResponse> {
  const url = "https://api.openai.com/v1/chat/completions";
  const body = JSON.stringify({ model, messages, stream, temperature, max_tokens: maxTokens });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
  }

  if (stream) {
    return { response: res, provider: "openai", model };
  }

  const json = (await res.json()) as OpenAIResponse;
  const tokensIn = json.usage?.prompt_tokens ?? 0;
  const tokensOut = json.usage?.completion_tokens ?? 0;

  return {
    response: new Response(JSON.stringify(json), { headers: { "Content-Type": "application/json" } }),
    provider: "openai",
    model,
    tokensIn,
    tokensOut,
  };
}
