# GABA AI Router — Cloudflare Worker

An edge-deployed AI router that sits between all clients and every AI provider.
Clients only ever see `https://api.gaba.ai` (or your worker domain); the underlying
provider API keys are stored as Cloudflare secrets and are never visible in client
code or the Flask app.

---

## Architecture

```
Client / Flask app
      │
      ▼
Cloudflare Worker  ←─ Supabase JWT auth
      │              ←─ KV rate limiting (50 req/hr free, unlimited pro)
      │              ←─ Cost tracking (waitUntil → Supabase usage_logs)
      ├── hormulse-pro       → GPT-4o      (fallback: Claude 3.5 Sonnet)
      ├── hormulse-fast      → Groq Llama  (fallback: GPT-4o-mini)
      ├── hormulse-reasoning → DeepSeek-R1 (fallback: GPT-4o)
      └── hormulse-vision    → Gemini 1.5  (fallback: GPT-4o)
```

---

## Endpoint

```
POST /v1/chat/completions
Authorization: Bearer <supabase_jwt>
Content-Type: application/json

{
  "messages": [{"role": "user", "content": "Hello"}],
  "model": "hormulse-fast",       // optional, default: hormulse-fast
  "stream": false,                // optional, default: false
  "temperature": 0.7,             // optional, default: 0.7
  "max_tokens": 2048              // optional, default: 2048
}
```

Response mirrors OpenAI's `/v1/chat/completions` schema.
Extra fields `_provider` and `_model` identify which backend served the request.

### Models

| Alias | Primary | Fallback |
|---|---|---|
| `hormulse-pro` | GPT-4o | Claude 3.5 Sonnet |
| `hormulse-fast` | Groq Llama-3.3-70B | GPT-4o-mini |
| `hormulse-reasoning` | DeepSeek-R1 | GPT-4o |
| `hormulse-vision` | Gemini 1.5 Pro | GPT-4o |

---

## One-Time Setup

### 1. Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

### 2. Install dependencies

```bash
cd workers
npm install
```

### 3. Create the KV namespace

```bash
wrangler kv namespace create RATE_LIMIT_KV
```

Copy the `id` it prints and replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` in `wrangler.toml`.

### 4. Set secrets

Run each command below and paste the value when prompted:

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GEMINI_API_KEY
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put GROQ_API_KEY
```

**Where to find each value:**

| Secret | Source |
|---|---|
| `SUPABASE_URL` | Supabase dashboard → Settings → API → Project URL |
| `SUPABASE_JWT_SECRET` | Supabase dashboard → Settings → API → JWT Secret |
| `SUPABASE_SERVICE_KEY` | Supabase dashboard → Settings → API → service_role key |
| `OPENAI_API_KEY` | platform.openai.com → API keys |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key |
| `DEEPSEEK_API_KEY` | platform.deepseek.com → API keys |
| `GROQ_API_KEY` | console.groq.com → API keys |

### 5. Create the Supabase `usage_logs` table

Run this SQL in your Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS usage_logs (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  model      TEXT NOT NULL,
  provider   TEXT NOT NULL,
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd   NUMERIC(12, 8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON usage_logs (user_id, created_at DESC);
CREATE INDEX ON usage_logs (created_at DESC);
```

### 6. Deploy

```bash
wrangler deploy
```

Wrangler will print your worker URL (e.g. `https://gaba-ai-router.<account>.workers.dev`).

### 7. Wire it to Flask

Add the worker URL as an environment variable in your Replit Secrets:

```
WORKER_URL = https://gaba-ai-router.<account>.workers.dev
```

The Flask app's `/chat` endpoint will automatically proxy through the worker when
`WORKER_URL` is set. If the variable is absent, Flask falls back to direct provider
calls — no breakage.

---

## Local development

```bash
cd workers
wrangler dev
```

This starts a local worker at `http://localhost:8787`. You can test it with:

```bash
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer <your_supabase_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}],"model":"hormulse-fast"}'
```

---

## Rate limits

| Plan | Limit |
|---|---|
| Free | 50 requests / hour |
| Pro | Unlimited |

Rate state is stored in Cloudflare KV under the key `rl:<user_id>` with a sliding
1-hour window. The response includes an `X-RateLimit-Remaining` header.
When the limit is hit the worker returns `429` with a `Retry-After` header (seconds).

---

## Cost tracking

After every successful (non-streaming) call, the worker fires a background
`waitUntil` task that POSTs a row to the `usage_logs` Supabase table. The row
includes `user_id`, `model`, `provider`, `tokens_in`, `tokens_out`, and `cost_usd`.
Cost rates are defined in `src/middleware/costTracker.ts` and can be updated without
redeploying by extending the `COST_TABLE`.

Streaming calls log 0 tokens (token counts are not available mid-stream from all
providers). Future work: parse the final SSE chunk for usage data.

---

## Files

```
workers/
├── package.json
├── tsconfig.json
├── wrangler.toml               ← KV binding + secret declarations
└── src/
    ├── index.ts                ← Hono app entry, CORS, route wiring
    ├── types.ts                ← Shared interfaces (Env, ChatMessage, …)
    ├── router.ts               ← Model alias → provider/model map + fallback logic
    ├── providers/
    │   ├── openai.ts
    │   ├── anthropic.ts
    │   ├── gemini.ts
    │   ├── deepseek.ts
    │   └── groq.ts
    └── middleware/
        ├── auth.ts             ← Supabase JWT verification (HMAC-SHA256)
        ├── rateLimit.ts        ← KV-backed sliding-window rate limiter
        └── costTracker.ts      ← Token cost table + Supabase usage_logs writer
```
