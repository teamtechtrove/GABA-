import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, ChatMessage } from "./types";
import { verifySupabaseJWT, extractBearerToken } from "./middleware/auth";
import { checkRateLimit } from "./middleware/rateLimit";
import { logUsage } from "./middleware/costTracker";
import { routeChat, MODEL_MAP } from "./router";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const allowedOrigins = (c.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o: string) => o.trim())
    .filter(Boolean);

  const origin = c.req.header("Origin") ?? "";
  const isAllowed =
    allowedOrigins.length === 0 ||
    allowedOrigins.some((o: string) => {
      if (o.includes("*")) {
        const pattern = o.replace(/\*/g, ".*");
        return new RegExp(`^${pattern}$`).test(origin);
      }
      return o === origin;
    });

  await cors({
    origin: isAllowed ? origin : allowedOrigins[0] ?? "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    credentials: true,
  })(c, next);
});

app.get("/health", (c) => c.json({ status: "ok", models: Object.keys(MODEL_MAP) }));

app.post("/v1/chat/completions", async (c) => {
  const authHeader = c.req.header("Authorization");
  const token = extractBearerToken(authHeader ?? null);

  if (!token) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  const user = await verifySupabaseJWT(token, c.env.SUPABASE_JWT_SECRET);
  if (!user) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const rateCheck = await checkRateLimit(c.env.RATE_LIMIT_KV, user.userId, user.plan);
  if (!rateCheck.allowed) {
    return c.json(
      { error: "Rate limit exceeded", retryAfter: rateCheck.retryAfter },
      429,
      { "Retry-After": String(rateCheck.retryAfter ?? 3600) }
    );
  }

  let body: {
    messages?: ChatMessage[];
    model?: string;
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return c.json({ error: "messages array required" }, 400);
  }

  const modelAlias = body.model ?? "hormulse-fast";
  const stream = body.stream ?? false;
  const temperature = body.temperature ?? 0.7;
  const maxTokens = body.max_tokens ?? 2048;

  let providerResult: Awaited<ReturnType<typeof routeChat>>;
  try {
    providerResult = await routeChat(messages, modelAlias, stream, temperature, maxTokens, c.env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Provider error";
    return c.json({ error: msg }, 502);
  }

  const { response, provider, model, tokensIn = 0, tokensOut = 0 } = providerResult;

  c.executionCtx.waitUntil(
    logUsage(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_SERVICE_KEY,
      user.userId,
      model,
      provider,
      tokensIn,
      tokensOut
    )
  );

  if (stream) {
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Provider": provider,
        "X-Model": model,
        "X-RateLimit-Remaining": String(rateCheck.remaining),
      },
    });
  }

  const data = await response.json();
  return c.json(
    { ...(data as object), _provider: provider, _model: model },
    200,
    {
      "X-Provider": provider,
      "X-Model": model,
      "X-RateLimit-Remaining": String(rateCheck.remaining),
    }
  );
});

export default app;
