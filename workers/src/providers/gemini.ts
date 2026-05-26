import type { ChatMessage, ProviderResponse } from "../types";
import { normalizeGeminiStream } from "../streamNormalizer";

export async function callGemini(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  stream: boolean,
  temperature: number,
  maxTokens: number,
  signal: AbortSignal
): Promise<ProviderResponse> {
  const endpoint = stream ? "streamGenerateContent" : "generateContent";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${endpoint}?key=${apiKey}${stream ? "&alt=sse" : ""}`;

  const parts = messages.map((m) => ({ text: `${m.role}: ${m.content}` }));
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
  }

  if (stream) {
    const normalized = normalizeGeminiStream(res.body!, model);
    return {
      response: new Response(normalized, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      }),
      provider: "gemini",
      model,
    };
  }

  const json = (await res.json()) as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  };
  const text = json.candidates[0]?.content?.parts[0]?.text ?? "";
  const tokensIn = json.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = json.usageMetadata?.candidatesTokenCount ?? 0;

  const openAIBody = JSON.stringify({
    choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut, total_tokens: tokensIn + tokensOut },
  });

  return {
    response: new Response(openAIBody, { headers: { "Content-Type": "application/json" } }),
    provider: "gemini",
    model,
    tokensIn,
    tokensOut,
  };
}
