const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeOpenAIChunk(content: string, model: string, id: string): string {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function makeOpenAIDoneChunk(model: string, id: string): string {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
}

function randomId(): string {
  return `chatcmpl-${Math.random().toString(36).slice(2, 12)}`;
}

export function normalizeAnthropicStream(
  body: ReadableStream<Uint8Array>,
  model: string
): ReadableStream<Uint8Array> {
  const id = randomId();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;

            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              continue;
            }

            const type = evt.type as string | undefined;

            if (type === "content_block_delta") {
              const delta = evt.delta as Record<string, unknown> | undefined;
              if (delta?.type === "text_delta") {
                const text = (delta.text as string) ?? "";
                controller.enqueue(encoder.encode(makeOpenAIChunk(text, model, id)));
              }
            } else if (type === "message_stop") {
              controller.enqueue(encoder.encode(makeOpenAIDoneChunk(model, id)));
            }
          }
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

export function normalizeGeminiStream(
  body: ReadableStream<Uint8Array>,
  model: string
): ReadableStream<Uint8Array> {
  const id = randomId();
  let buffer = "";
  let doneSent = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;

            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              continue;
            }

            type GeminiCandidate = {
              content?: { parts?: Array<{ text?: string }> };
              finishReason?: string;
            };

            const candidates = evt.candidates as GeminiCandidate[] | undefined;
            if (!candidates || candidates.length === 0) continue;

            const candidate = candidates[0];
            const parts = candidate.content?.parts ?? [];
            const text = parts.map((p) => p.text ?? "").join("");

            if (text) {
              controller.enqueue(encoder.encode(makeOpenAIChunk(text, model, id)));
            }

            if (candidate.finishReason && !doneSent) {
              controller.enqueue(encoder.encode(makeOpenAIDoneChunk(model, id)));
              doneSent = true;
            }
          }
        }

        if (!doneSent) {
          controller.enqueue(encoder.encode(makeOpenAIDoneChunk(model, id)));
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}
