import type { ModelConfig } from "../types";

const COST_TABLE: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 0.005, out: 0.015 },
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "claude-3-5-sonnet-20241022": { in: 0.003, out: 0.015 },
  "claude-3-haiku-20240307": { in: 0.00025, out: 0.00125 },
  "gemini-1.5-pro": { in: 0.00125, out: 0.005 },
  "gemini-1.5-flash": { in: 0.000075, out: 0.0003 },
  "deepseek-reasoner": { in: 0.00055, out: 0.00219 },
  "deepseek-chat": { in: 0.00014, out: 0.00028 },
  "llama-3.3-70b-versatile": { in: 0.00059, out: 0.00079 },
  "llama-3.1-8b-instant": { in: 0.00005, out: 0.00008 },
};

export function calcCost(model: string, tokensIn: number, tokensOut: number): number {
  const rates = COST_TABLE[model] ?? { in: 0, out: 0 };
  return (tokensIn / 1000) * rates.in + (tokensOut / 1000) * rates.out;
}

export async function logUsage(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  model: string,
  provider: string,
  tokensIn: number,
  tokensOut: number
): Promise<void> {
  const costUsd = calcCost(model, tokensIn, tokensOut);
  const payload = {
    user_id: userId,
    model,
    provider,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: costUsd,
    created_at: new Date().toISOString(),
  };

  await fetch(`${supabaseUrl}/rest/v1/usage_logs`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });
}
