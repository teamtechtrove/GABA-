-- ============================================================
-- GABA Platform Schema — Migration 001
-- Run once in the Supabase SQL editor or via Supabase CLI.
-- All ALTER TABLE statements are additive (DEFAULT values)
-- so existing rows are NOT affected.
-- Idempotent: safe to re-run.
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. INSTITUTIONS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS institutions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  domain      TEXT,
  plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_institutions_domain ON institutions (domain);

-- ──────────────────────────────────────────────────────────
-- 2. ALTER EXISTING users TABLE (additive only)
-- ──────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan           TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS display_name   TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url     TEXT;

CREATE INDEX IF NOT EXISTS idx_users_institution ON users (institution_id);
CREATE INDEX IF NOT EXISTS idx_users_plan        ON users (plan);

-- ──────────────────────────────────────────────────────────
-- 3. ALTER EXISTING conversations TABLE (additive only)
-- ──────────────────────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS title       TEXT,
  ADD COLUMN IF NOT EXISTS token_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd    NUMERIC(10,6) DEFAULT 0;

-- ──────────────────────────────────────────────────────────
-- 4. MESSAGES
--    conversations.id is SERIAL (INT4) — use INTEGER FK
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         UUID    REFERENCES users (id) ON DELETE SET NULL,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  provider_used   TEXT,
  token_count     INTEGER DEFAULT 0,
  cost_usd        NUMERIC(10,6) DEFAULT 0,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user         ON messages (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created      ON messages (created_at DESC);

-- ──────────────────────────────────────────────────────────
-- 5. DOCUMENTS  (stub — no embeddings yet)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users (id) ON DELETE CASCADE,
  title       TEXT,
  content     TEXT,
  mime_type   TEXT DEFAULT 'text/plain',
  size_bytes  INTEGER DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON documents (user_id);

-- ──────────────────────────────────────────────────────────
-- 6. USAGE_LOGS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_logs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES users (id) ON DELETE SET NULL,
  provider      TEXT,
  model         TEXT,
  tokens_in     INTEGER DEFAULT 0,
  tokens_out    INTEGER DEFAULT 0,
  cost_usd      NUMERIC(10,6) DEFAULT 0,
  logged_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_user      ON usage_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_logged_at ON usage_logs (logged_at DESC);

-- ──────────────────────────────────────────────────────────
-- 7. SUBSCRIPTIONS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  plan                   TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  status                 TEXT NOT NULL DEFAULT 'inactive',
  current_period_start   TIMESTAMP WITH TIME ZONE,
  current_period_end     TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end   BOOLEAN DEFAULT FALSE,
  created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub      ON subscriptions (stripe_subscription_id);

-- ──────────────────────────────────────────────────────────
-- 8. PERSONAS
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  system_prompt TEXT NOT NULL,
  is_public     BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personas_user      ON personas (user_id);
CREATE INDEX IF NOT EXISTS idx_personas_is_public ON personas (is_public);

-- ──────────────────────────────────────────────────────────
-- 9. ROW LEVEL SECURITY
--    Postgres does not support CREATE POLICY IF NOT EXISTS.
--    We drop-then-create so this block is idempotent.
--    The service-role key used by Flask bypasses RLS entirely.
-- ──────────────────────────────────────────────────────────

ALTER TABLE institutions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas      ENABLE ROW LEVEL SECURITY;

-- ── institutions ──────────────────────────────────────────
DROP POLICY IF EXISTS "institutions_read_own_inst"   ON institutions;
DROP POLICY IF EXISTS "institutions_read_members"    ON institutions;

-- Members of an institution can read it
CREATE POLICY "institutions_read_own_inst" ON institutions
  FOR SELECT
  USING (id IN (SELECT institution_id FROM users WHERE id = auth.uid()));

-- Institution admins (enterprise users sharing the same institution) can read members' rows
CREATE POLICY "institutions_read_members" ON users
  FOR SELECT
  USING (
    institution_id IS NOT NULL AND
    institution_id IN (SELECT institution_id FROM users WHERE id = auth.uid())
  );

-- ── messages ──────────────────────────────────────────────
DROP POLICY IF EXISTS "messages_select_own" ON messages;
DROP POLICY IF EXISTS "messages_insert_own" ON messages;
DROP POLICY IF EXISTS "messages_update_own" ON messages;
DROP POLICY IF EXISTS "messages_delete_own" ON messages;

CREATE POLICY "messages_select_own" ON messages FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "messages_insert_own" ON messages FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "messages_update_own" ON messages FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "messages_delete_own" ON messages FOR DELETE USING (user_id = auth.uid());

-- ── documents ─────────────────────────────────────────────
DROP POLICY IF EXISTS "documents_select_own" ON documents;
DROP POLICY IF EXISTS "documents_insert_own" ON documents;
DROP POLICY IF EXISTS "documents_update_own" ON documents;
DROP POLICY IF EXISTS "documents_delete_own" ON documents;

CREATE POLICY "documents_select_own" ON documents FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "documents_insert_own" ON documents FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "documents_update_own" ON documents FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "documents_delete_own" ON documents FOR DELETE USING (user_id = auth.uid());

-- ── usage_logs ────────────────────────────────────────────
DROP POLICY IF EXISTS "usage_logs_select_own" ON usage_logs;
DROP POLICY IF EXISTS "usage_logs_insert_own" ON usage_logs;

CREATE POLICY "usage_logs_select_own" ON usage_logs FOR SELECT USING (user_id = auth.uid());
-- Insert allowed for own rows (service role bypasses this for backend writes)
CREATE POLICY "usage_logs_insert_own" ON usage_logs FOR INSERT WITH CHECK (user_id = auth.uid());

-- ── subscriptions ─────────────────────────────────────────
DROP POLICY IF EXISTS "subscriptions_select_own" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_insert_own" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_update_own" ON subscriptions;

CREATE POLICY "subscriptions_select_own" ON subscriptions FOR SELECT USING (user_id = auth.uid());
-- Backend (service role) upserts subscriptions; client-side insert restricted to own row
CREATE POLICY "subscriptions_insert_own" ON subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "subscriptions_update_own" ON subscriptions FOR UPDATE USING (user_id = auth.uid());

-- ── personas ──────────────────────────────────────────────
DROP POLICY IF EXISTS "personas_select_own_or_public" ON personas;
DROP POLICY IF EXISTS "personas_insert_own"           ON personas;
DROP POLICY IF EXISTS "personas_update_own"           ON personas;
DROP POLICY IF EXISTS "personas_delete_own"           ON personas;

CREATE POLICY "personas_select_own_or_public" ON personas
  FOR SELECT USING (is_public = TRUE OR user_id = auth.uid());
CREATE POLICY "personas_insert_own" ON personas FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "personas_update_own" ON personas FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "personas_delete_own" ON personas FOR DELETE USING (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────
-- 10. SEED — default provider_order (idempotent)
-- ──────────────────────────────────────────────────────────
INSERT INTO system_settings (key, value)
VALUES ('provider_order', '["groq","openai","claude","gemini","deepseek"]')
ON CONFLICT (key) DO NOTHING;
