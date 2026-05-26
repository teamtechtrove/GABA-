import type { KVNamespace } from "@cloudflare/workers-types";

const FREE_LIMIT_PER_HOUR = 50;
const WINDOW_SECONDS = 3600;

interface RateState {
  count: number;
  windowStart: number;
}

export async function checkRateLimit(
  kv: KVNamespace,
  userId: string,
  plan: "free" | "pro"
): Promise<{ allowed: boolean; retryAfter?: number; remaining: number }> {
  if (plan === "pro") {
    return { allowed: true, remaining: 999999 };
  }

  const key = `rl:${userId}`;
  const now = Math.floor(Date.now() / 1000);

  const raw = await kv.get(key);
  let state: RateState = raw
    ? (JSON.parse(raw) as RateState)
    : { count: 0, windowStart: now };

  if (now - state.windowStart >= WINDOW_SECONDS) {
    state = { count: 0, windowStart: now };
  }

  if (state.count >= FREE_LIMIT_PER_HOUR) {
    const retryAfter = WINDOW_SECONDS - (now - state.windowStart);
    return { allowed: false, retryAfter, remaining: 0 };
  }

  state.count += 1;
  const ttl = WINDOW_SECONDS - (now - state.windowStart) + 60;
  await kv.put(key, JSON.stringify(state), { expirationTtl: ttl });

  return { allowed: true, remaining: FREE_LIMIT_PER_HOUR - state.count };
}
