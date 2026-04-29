# GABA — your AI brain

A fast, multi-model AI chat assistant. Built with Flask + vanilla JS (no React) for full control on Replit free tier.

Live creator: **Arman** — https://portfolioofarman.netlify.app

---

## What's inside

### Backend (`main.py`, Flask)
- **Multi-LLM fallback**: Groq → OpenAI → Claude → Gemini → DeepSeek (order editable from admin panel)
- **Web search tool**: DuckDuckGo HTML scrape, auto-triggered when the user says "search", "find online", "google"
- **Supabase auth** for user accounts (signup/login/logout/me) — uses the service-role key
- **Supabase database** for: `api_keys`, `system_settings`, `users`, `conversations`
- **Admin console** (small lock icon, bottom-left of chat area → password prompt)
  - **Dashboard**: live stats + 1-click provider probe (latency + reply preview) + clear-rate-limit-cache
  - **Keys**: API key CRUD per provider with per-row "Test" button
  - **Providers**: drag-drop fallback order + per-provider enable/disable toggle
  - **Settings**: web-search on/off, sign-up open/closed, rate limit per IP per minute (1–600)
  - **Prompt**: live system-prompt editor (8000 char) with default reset; takes effect immediately on next chat
  - **Users**: list, search, conversation count per user, delete user (cascades to conversations + Supabase Auth)
  - **Chats**: search & view recent conversations with provider chips, delete log entries
  - **Backup**: manual project bundle to Supabase Storage / GitHub
  - **Exports**: download users / conversations / settings as JSON
  - **Password**: change admin password (stored as SHA-256 hash in `system_settings`, overrides env var)
- **Settings cache**: 15s in-memory TTL on the `system_settings` table to keep chat path fast
- **Safety**: hardened system prompt (overridable from admin) + jailbreak regex blocklist + output sanitisation that redacts leaked secrets
- **Rate limiting**: configurable per-IP per-minute (default 30, range 1–600)

### Frontend (`template/index.html`, `static/style.css`, `static/script.js`)
- Premium dark theme with animated gradient orbs, glassmorphism cards, grid background
- Inter + Space Grotesk + JetBrains Mono fonts
- Welcome hero with gradient logo, suggestion cards, capability strip
- Chat: avatars, gradient user bubbles, glass bot bubbles, streaming typewriter, code blocks with copy button, full markdown
- Composer: pill input with attach / voice / send, gradient send button, char counter
- Sidebar: brand mark, new-chat CTA, recent history, account, creator card with portfolio link
- Voice input via Web Speech API
- Auth modal, hidden admin console (gradient header, key list, drag-drop priority editor, backup button)

### Backup & recovery (`backup.py`)
- Zips the project (excludes `__pycache__`, `.git`, `venv`, `.pythonlibs`)
- Uploads ZIP to Supabase Storage `backups` bucket
- Optionally pushes to GitHub if `GITHUB_TOKEN` + `GITHUB_REPO` are set
- Recovery: spin up a fresh Repl, drop in the ZIP, set the same Secrets, `pip install -r requirements.txt`, run

---

## Required Secrets

| Key | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` (or `SUPABASE_KEY`) | Service-role key for DB + Auth |
| `ADMIN_PASSWORD` | Password for hidden admin panel |
| `FLASK_SECRET` | (optional) Flask session secret |
| `GROQ_API_KEY` | (optional fallback) — also stored in `api_keys` table |
| `GITHUB_TOKEN`, `GITHUB_REPO` | (optional) for backup → GitHub push |

API keys for OpenAI, Claude, Gemini, DeepSeek are added through the admin panel (stored in Supabase, not env vars).

---

## Supabase schema (one-time SQL)

```sql
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  api_key TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  user_message TEXT,
  bot_reply TEXT,
  provider_used TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO system_settings (key, value)
VALUES ('provider_order', '["groq","openai","claude","gemini","deepseek"]')
ON CONFLICT (key) DO NOTHING;
```

Also create a Storage bucket named `backups` (private).

---

## Workflow

- Workflow `Start application` runs `python main.py`
- Server binds to `0.0.0.0:5000` (mapped to public 80)
- Routes: `/`, `/chat`, `/auth/*`, `/admin/*`, `/health`

---

## Architecture notes

- Templates live in `template/` (singular — Flask configured with `template_folder="template"`)
- Static assets in `static/` (`style.css`, `script.js`)
- All UI element IDs are preserved across redesigns so JS handlers keep working
- Body classes `state-welcome` / `state-chat` toggle the hero vs chat view
- No build step, no React, no bundler — pure HTML/CSS/JS for full file-level control
