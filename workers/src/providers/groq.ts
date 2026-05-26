import type { ChatMessage, ProviderResponse } from "../types";

interface GroqResponse {
  choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export async function callGroq(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  stream: boolean,
  temperature: number,
  maxTokens: number,
  signal: AbortSignal
): Promise<ProviderResponse> {
  const url = "https://api.groq.com/openai/v1/chat/completions";
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
    throw new Error(`Groq ${res.status}: ${text.slice(0, 200)}`);
  }

  if (stream) {
    return { response: res, provider: "groq", model };
  }

  const json = (await res.json()) as GroqResponse;
  const tokensIn = json.usage?.prompt_tokens ?? 0;
  const tokensOut = json.usage?.completion_tokens ?? 0;

  return {
    response: new Response(JSON.stringify(json), { headers: { "Content-Type": "application/json" } }),
    provider: "groq",
    model,
    tokensIn,
    tokensOut,
  };
}
