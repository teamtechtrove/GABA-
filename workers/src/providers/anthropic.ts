import type { ChatMessage, ProviderResponse } from "../types";
import { normalizeAnthropicStream } from "../streamNormalizer";

export async function callAnthropic(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  stream: boolean,
  temperature: number,
  maxTokens: number,
  signal: AbortSignal
): Promise<ProviderResponse> {
  const url = "https://api.anthropic.com/v1/messages";

  const systemMsg = messages.find((m) => m.role === "system");
  const userMsgs = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model,
    messages: userMsgs,
    max_tokens: maxTokens,
    temperature,
    stream,
  };
  if (systemMsg) body.system = systemMsg.content;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }

  if (stream) {
    const normalized = normalizeAnthropicStream(res.body!, model);
    return {
      response: new Response(normalized, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      }),
      provider: "anthropic",
      model,
    };
  }

  const json = (await res.json()) as {
    content: Array<{ text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  const text = json.content[0]?.text ?? "";
  const tokensIn = json.usage?.input_tokens ?? 0;
  const tokensOut = json.usage?.output_tokens ?? 0;

  const openAIBody = JSON.stringify({
    choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut, total_tokens: tokensIn + tokensOut },
  });

  return {
    response: new Response(openAIBody, { headers: { "Content-Type": "application/json" } }),
    provider: "anthropic",
    model,
    tokensIn,
    tokensOut,
  };
}
