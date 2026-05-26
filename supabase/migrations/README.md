# Supabase Migrations

## How to run

### Option A — Supabase SQL editor (simplest)

1. Open your Supabase project → **SQL Editor**
2. Paste the contents of `001_platform_schema.sql`
3. Click **Run**

That's it. All statements are idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`) so re-running is safe.

### Option B — Supabase CLI

```bash
# Install the CLI if you haven't already
npm install -g supabase

# Link to your project (run once)
supabase link --project-ref <your-project-ref>

# Push the migration
supabase db push
```

## Migration history

| File | Description |
|------|-------------|
| `001_platform_schema.sql` | Adds `institutions`, `messages`, `documents`, `usage_logs`, `subscriptions`, `personas` tables. Extends `users` with `plan`, `institution_id`, `display_name`, `avatar_url`. Extends `conversations` with `title`, `token_count`, `cost_usd`. Enables RLS on all new tables. |

## Notes

- All `ALTER TABLE` statements use `ADD COLUMN IF NOT EXISTS` with `DEFAULT` values — existing rows are **not affected**.
- RLS policies use `auth.uid()` so the Supabase service-role key (used by Flask) bypasses them by design. Policies only restrict client-side access.
- The `documents` table is a stub — `pgvector` embeddings are added in a future migration.
