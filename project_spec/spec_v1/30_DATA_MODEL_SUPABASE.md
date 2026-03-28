# webhost.systems — Data Model (Supabase/PostgreSQL) & Access Control (v1)
Version: 1.0
Status: Implementation-ready
Last updated: 2026-03-28

This document defines the **normative Supabase/PostgreSQL data model** for webhost.systems, including:
- required tables and columns,
- indexes,
- invariants and state machines,
- Row Level Security (RLS) policies using `auth.uid()`,
- retention and deletion semantics,
- example query patterns and aggregation guidance.

Normative language: MUST, MUST NOT, SHOULD, MAY.

---

## 1) Design goals

### 1.1 Goals
The data model MUST support:
- strong tenant isolation (per-user ownership via RLS),
- immutable deployment history with rollback,
- auditable changes to sensitive operations (deploy, billing, secrets),
- efficient listing and time-range metrics queries,
- usage aggregation by billing period,
- multi-runtime metadata (Cloudflare + AgentCore),
- idempotent operations (deploy, telemetry ingestion).

### 1.2 Non-goals
- Teams/orgs/roles in v1 (single-owner resources only).
- Perfect cost reconciliation (store "estimated cost" until provider billing exports exist).

---

## 2) Cross-cutting conventions

### 2.1 IDs and references
- All primary keys are `uuid` using `gen_random_uuid()` as default.
- Foreign key columns MUST use `uuid` referencing the target table's `id`.
- The `users.id` column maps directly to Supabase Auth `auth.uid()` (type `uuid`).

### 2.2 Time
- Store times as `timestamptz` (timestamp with time zone) for native PostgreSQL time operations, indexing, and range queries.
- Convert to RFC3339 only at API boundaries (UI/API layer) if needed; `timestamptz` serializes naturally as ISO 8601.

Required time columns:
- `created_at` on all top-level entities (default `now()`).
- `updated_at` where mutable (users, agents, billing_usage, subscriptions).

### 2.3 Immutability rules
- `deployments` are immutable except for:
  - `status`,
  - `provider_ref` (once known),
  - `error_message`,
  - `finished_at`.
- `metrics_events` are append-only (never update; only delete via retention policy jobs).
- `audit_log` is append-only.

### 2.4 Multi-runtime modeling
- Use `runtime_provider` as the canonical selector: `'cloudflare' | 'agentcore'` (enforced by CHECK constraint).
- Store runtime-specific config in a JSONB column with a tagged structure:
  - `provider_config->'cloudflare'` object (nullable within JSON)
  - `provider_config->'agentcore'` object (nullable within JSON)
- Exactly one provider key MUST be non-null for a given agent/deployment where applicable.

### 2.5 "Active" pointer
- `agents.active_deployment_id` points to the currently active deployment (nullable if none).
- Rollback is implemented by switching `active_deployment_id` to a prior deployment (that is in a valid state).

### 2.6 Secrets
- Sensitive values (API keys, provider credentials) MUST be stored in **Supabase Vault** (`vault.secrets`), never in application tables.
- Application tables store only key names and vault secret references/metadata.

---

## 3) Custom types

```sql
-- Runtime provider enum
CREATE TYPE runtime_provider AS ENUM ('cloudflare', 'agentcore');

-- Agent status enum
CREATE TYPE agent_status AS ENUM ('created', 'deploying', 'active', 'error', 'disabled');

-- Deployment status enum
CREATE TYPE deployment_status AS ENUM ('deploying', 'active', 'failed', 'rolled_back');

-- Subscription status enum
CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'trialing', 'paused');

-- Subscription tier enum
CREATE TYPE subscription_tier AS ENUM ('free', 'starter', 'pro', 'enterprise');

-- Error class enum for metrics
CREATE TYPE error_class AS ENUM ('auth', 'limit', 'runtime', 'tool', 'unknown');

-- Billing provider enum
CREATE TYPE billing_provider AS ENUM ('lemonsqueezy', 'other');
```

---

## 4) Tables (normative)

> Naming is normative for this spec. If you rename, preserve semantics, indexes, and invariants.

### 4.1 `users`
Represents the tenant owner. The `id` column is the Supabase Auth user ID (`auth.uid()`).

```sql
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT auth.uid(),
  email           text NOT NULL,
  name            text,
  subscription_tier subscription_tier NOT NULL DEFAULT 'free',
  default_runtime_provider runtime_provider NOT NULL DEFAULT 'cloudflare',
  billing_customer_id text,
  disabled        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE UNIQUE INDEX idx_users_email ON users (email);
```

Invariants:
- One row per Supabase Auth user (PK = `auth.uid()`).
- `subscription_tier` MUST be set (default `free`).

RLS policies:
```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can read their own row
CREATE POLICY users_select_own ON users
  FOR SELECT USING (id = auth.uid());

-- Users can update their own row (except subscription_tier, handled server-side)
CREATE POLICY users_update_own ON users
  FOR UPDATE USING (id = auth.uid());

-- Insert: allow authenticated users to create their own row (on first login)
CREATE POLICY users_insert_own ON users
  FOR INSERT WITH CHECK (id = auth.uid());
```

Access control:
- User can read their own user row.
- Mutations to `subscription_tier` MUST be server-only (Edge Function webhook or service_role key).

---

### 4.2 `agents`
Logical agent entity owned by a user.

```sql
CREATE TABLE agents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  description           text,
  framework             text,
  runtime_provider      runtime_provider NOT NULL DEFAULT 'cloudflare',
  status                agent_status NOT NULL DEFAULT 'created',
  active_deployment_id  uuid,  -- FK added after deployments table exists
  env_var_keys          text[] NOT NULL DEFAULT '{}',
  provider_config       jsonb NOT NULL DEFAULT '{}',
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_deployed_at      timestamptz,
  last_invocation_at    timestamptz,

  CONSTRAINT agents_name_length CHECK (char_length(name) <= 64),
  CONSTRAINT agents_description_length CHECK (description IS NULL OR char_length(description) <= 4000),
  CONSTRAINT agents_env_var_keys_length CHECK (array_length(env_var_keys, 1) IS NULL OR array_length(env_var_keys, 1) <= 128)
);

-- Indexes
CREATE INDEX idx_agents_user_id ON agents (user_id);
CREATE UNIQUE INDEX idx_agents_user_id_name ON agents (user_id, name) WHERE deleted_at IS NULL;
```

The deferred FK for `active_deployment_id` is added after the `deployments` table:
```sql
ALTER TABLE agents
  ADD CONSTRAINT fk_agents_active_deployment
  FOREIGN KEY (active_deployment_id) REFERENCES deployments(id);
```

`provider_config` JSONB structure:
```json
{
  "cloudflare": {
    "worker_name": "string | null",
    "worker_url": "string | null",
    "durable_object_namespace": "string | null",
    "durable_object_id": "string | null"
  },
  "agentcore": {
    "agent_runtime_arn": "string | null",
    "agent_runtime_id": "string | null",
    "runtime_id": "string | null",
    "region": "string | null",
    "v_cpu": "number | null",
    "memory_mb": "number | null",
    "memory_enabled": "boolean | null",
    "code_interpreter_enabled": "boolean | null",
    "browser_enabled": "boolean | null"
  }
}
```

Invariants:
- `user_id` MUST exist.
- If `active_deployment_id` is set:
  - it MUST reference a deployment with `deployments.agent_id == agents.id`,
  - the deployment SHOULD be `status='active'` (or at least not `'failed'`).
- `provider_config->'cloudflare'` MUST be non-null when `runtime_provider='cloudflare'` (once deployed), and `provider_config->'agentcore'` MUST be null (and vice versa). During `'created'` state, both may be null.

RLS policies:
```sql
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY agents_select_own ON agents
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY agents_insert_own ON agents
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY agents_update_own ON agents
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY agents_delete_own ON agents
  FOR DELETE USING (user_id = auth.uid());
```

Access control:
- Only the owning user may read/write agent rows (except server-side billing/deploy workflows via `service_role`).
- Changing `runtime_provider` MUST be gated by entitlements (tier check).
- Agent deletion SHOULD be soft-delete with `deleted_at` set; invocations MUST fail for deleted/disabled agents.

State machine (normative):
- `created` -> `deploying` when a new deployment begins
- `deploying` -> `active` when deployment succeeds and becomes active
- `deploying` -> `error` when deployment fails
- any -> `disabled` via manual disable
- `disabled` -> `active` (optional "enable") if there is an active deployment
- `error` -> `deploying` on redeploy attempt

---

### 4.3 `deployments`
Immutable deployment record.

```sql
CREATE TABLE deployments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  agent_id            uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version             integer NOT NULL,
  runtime_provider    runtime_provider NOT NULL,
  status              deployment_status NOT NULL DEFAULT 'deploying',
  commit_hash         text,
  artifact            jsonb NOT NULL DEFAULT '{}',
  manifest            jsonb,
  provider_ref        jsonb NOT NULL DEFAULT '{}',
  error_message       text,
  logs_ref            jsonb,
  idempotency_key     text,
  telemetry_auth_ref  jsonb,
  deployed_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deployed_at         timestamptz,
  finished_at         timestamptz,

  CONSTRAINT deployments_version_positive CHECK (version > 0),
  CONSTRAINT deployments_unique_version UNIQUE (agent_id, version)
);

-- Indexes
CREATE INDEX idx_deployments_agent_id_created_at ON deployments (agent_id, created_at DESC);
CREATE INDEX idx_deployments_agent_id_version ON deployments (agent_id, version DESC);
CREATE INDEX idx_deployments_user_id_created_at ON deployments (user_id, created_at DESC);
CREATE INDEX idx_deployments_status_created_at ON deployments (status, created_at DESC);
```

`artifact` JSONB structure:
```json
{
  "type": "uploaded_bundle | repo_ref",
  "uploaded_bundle": {
    "upload_id": "string",
    "checksum": "string",
    "size_bytes": "number"
  },
  "repo_ref": {
    "github_url": "string",
    "ref": "string"
  },
  "agentcore_container": {
    "image_uri": "string",
    "image_digest": "string | null",
    "repository": "string | null",
    "tag": "string | null",
    "build_id": "string | null"
  }
}
```

`provider_ref` JSONB structure:
```json
{
  "cloudflare": {
    "worker_url": "string | null",
    "durable_object_id": "string | null"
  },
  "agentcore": {
    "agent_runtime_arn": "string | null",
    "agent_runtime_id": "string | null",
    "runtime_id": "string | null",
    "region": "string | null",
    "memory_enabled": "boolean | null",
    "code_interpreter_enabled": "boolean | null",
    "browser_enabled": "boolean | null"
  }
}
```

Invariants:
- `agent_id` MUST exist and belong to `user_id`.
- `version` MUST be unique per `agent_id` and monotonic increasing (enforced by UNIQUE constraint).
- `status` transitions:
  - `deploying` -> `active` OR `failed`
  - `active` may become `rolled_back` when another deployment becomes active (optional bookkeeping)
- `provider_ref` must align with `runtime_provider` (only one non-null once deployed).

RLS policies:
```sql
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY deployments_select_own ON deployments
  FOR SELECT USING (user_id = auth.uid());

-- Insert/update restricted to server-side (service_role) via Edge Functions
-- No client INSERT/UPDATE policies; use service_role key in Edge Functions
```

Access control:
- User can list and read deployments for their own agents.
- Only server-side code (Edge Functions with `service_role` key) can create deployments.
- `provider_ref`, `status`, and `error_message` updates MUST be server-only.

---

### 4.4 `metrics_events` (raw telemetry, append-only)
Stores per-invocation telemetry events. This is the "source of truth" for usage aggregation.

```sql
CREATE TABLE metrics_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  agent_id            uuid NOT NULL REFERENCES agents(id),
  deployment_id       uuid REFERENCES deployments(id),
  runtime_provider    runtime_provider NOT NULL,
  timestamp           timestamptz NOT NULL,
  requests            integer NOT NULL DEFAULT 1,
  llm_tokens          integer NOT NULL DEFAULT 0,
  compute_ms          integer NOT NULL DEFAULT 0,
  errors              integer NOT NULL DEFAULT 0,
  error_class         error_class,
  trace_id            text,
  provider            jsonb NOT NULL DEFAULT '{}',
  cost_usd_estimated  numeric(12,6) NOT NULL DEFAULT 0,
  bucket_key          text,
  ingest_source       text,
  ingest_deployment_key_id text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Indexes (MUST)
CREATE INDEX idx_metrics_events_user_id_timestamp ON metrics_events (user_id, timestamp DESC);
CREATE INDEX idx_metrics_events_agent_id_timestamp ON metrics_events (agent_id, timestamp DESC);

-- Indexes (SHOULD)
CREATE INDEX idx_metrics_events_deployment_id_timestamp ON metrics_events (deployment_id, timestamp DESC)
  WHERE deployment_id IS NOT NULL;

-- Indexes (MAY)
CREATE INDEX idx_metrics_events_user_id_bucket_key ON metrics_events (user_id, bucket_key)
  WHERE bucket_key IS NOT NULL;
```

`provider` JSONB structure:
```json
{
  "cloudflare": {
    "durable_object_ops": "number | null",
    "workers_ai_calls": "number | null"
  },
  "agentcore": {
    "session_duration_ms": "number | null",
    "tool_invocations": "number | null",
    "browser_interactions": "number | null"
  }
}
```

Invariants:
- Events are append-only.
- `user_id` and `agent_id` MUST match actual ownership at the time of ingestion:
  - control plane MUST validate that `agents.user_id == user_id`.
- If `deployment_id` is present:
  - control plane MUST validate `deployments.agent_id == agent_id` and `deployments.user_id == user_id`.

RLS policies:
```sql
ALTER TABLE metrics_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own metrics
CREATE POLICY metrics_events_select_own ON metrics_events
  FOR SELECT USING (user_id = auth.uid());

-- Inserts are server-only (telemetry ingestion Edge Function with service_role)
-- No client INSERT policy
```

Access control:
- Users can query aggregated views derived from metrics; direct raw access MAY be allowed but SHOULD be restricted:
  - If exposing raw events, ensure tenant checks (RLS) and pagination limits.
- Inserts into `metrics_events` MUST be server-only via telemetry ingestion Edge Function with signature verification.

Retention:
- Raw events SHOULD be retained by tier:
  - free: 7 days
  - starter: 14 days
  - pro: 30 days
  - enterprise: 90+ days (or configurable)
- Aggregated usage MUST be retained longer (see `billing_usage`).
- Retention SHOULD be enforced via **pg_cron** scheduled jobs (see section 6.3).

---

### 4.5 `billing_usage` (aggregated usage per billing period)
Stores per-user aggregate usage for a billing period (e.g., monthly).

```sql
CREATE TABLE billing_usage (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  period_key          text NOT NULL,
  period_start        timestamptz NOT NULL,
  period_end          timestamptz NOT NULL,
  totals              jsonb NOT NULL DEFAULT '{}',
  by_runtime          jsonb NOT NULL DEFAULT '{}',
  last_aggregated_at  timestamptz NOT NULL DEFAULT now(),
  paid                boolean NOT NULL DEFAULT false,
  invoice_id          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT billing_usage_unique_user_period UNIQUE (user_id, period_key)
);

-- Indexes
CREATE INDEX idx_billing_usage_user_id_period_key ON billing_usage (user_id, period_key);
CREATE INDEX idx_billing_usage_period_key ON billing_usage (period_key);
```

`totals` JSONB structure:
```json
{
  "requests": "number",
  "tokens": "number",
  "compute_ms": "number",
  "cost_usd_estimated": "number"
}
```

`by_runtime` JSONB structure:
```json
{
  "cloudflare": { "requests": 0, "tokens": 0, "compute_ms": 0, "cost_usd_estimated": 0 },
  "agentcore": { "requests": 0, "tokens": 0, "compute_ms": 0, "cost_usd_estimated": 0 }
}
```

Invariants:
- One row per `(user_id, period_key)` (enforced by UNIQUE constraint).
- Aggregation should be idempotent and can be recomputed.

RLS policies:
```sql
ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_usage_select_own ON billing_usage
  FOR SELECT USING (user_id = auth.uid());

-- Writes are server-only (aggregation job via service_role)
```

Access control:
- User can read their own `billing_usage`.
- Writes are server-only (Edge Function aggregation job, billing webhook handler).

---

### 4.6 `subscriptions` (optional but recommended for clarity)
Tracks subscription lifecycle independent of `users.subscription_tier`.

```sql
CREATE TABLE subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES users(id),
  provider                  billing_provider NOT NULL DEFAULT 'lemonsqueezy',
  provider_customer_id      text,
  provider_subscription_id  text,
  status                    subscription_status NOT NULL DEFAULT 'active',
  tier                      subscription_tier NOT NULL DEFAULT 'free',
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_subscriptions_user_id ON subscriptions (user_id);
CREATE UNIQUE INDEX idx_subscriptions_provider_subscription_id
  ON subscriptions (provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
```

Invariants:
- At most one active subscription per user in v1.

RLS policies:
```sql
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_select_own ON subscriptions
  FOR SELECT USING (user_id = auth.uid());

-- Writes are server-only (webhook handler via service_role)
```

Access control:
- User can read their own subscription record.
- Writes are server-only (webhook handler).

---

### 4.7 `audit_log` (append-only)
Records privileged actions for auditability.

```sql
CREATE TABLE audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  actor_user_id   uuid NOT NULL REFERENCES users(id),
  action          text NOT NULL,
  target          jsonb,
  metadata        jsonb,
  trace_id        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_audit_log_user_id_created_at ON audit_log (user_id, created_at DESC);
CREATE INDEX idx_audit_log_action_created_at ON audit_log (action, created_at DESC);
```

Action values (normative enum, enforced in application code):
- `agent.create`
- `agent.update`
- `agent.disable`
- `agent.delete`
- `deployment.create`
- `deployment.status_update`
- `deployment.activate`
- `billing.checkout_created`
- `billing.webhook_processed`
- `secrets.set`
- `telemetry.rejected`

RLS policies:
```sql
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select_own ON audit_log
  FOR SELECT USING (user_id = auth.uid());

-- Writes are server-only (service_role)
```

Access control:
- User can read their own audit log (optional UI).
- Writes are server-only.

---

## 5) Indexing guidance (PostgreSQL specifics)

PostgreSQL indexes should be selected to support the core query paths:
- list agents by user
- list deployments by agent in descending time order
- query metrics by agent and time range
- query usage by period
- find user by `auth.uid()` (PK lookup, no index needed)

Required index set (minimum):
- `agents.idx_agents_user_id`
- `deployments.idx_deployments_agent_id_created_at`
- `deployments.idx_deployments_agent_id_version`
- `metrics_events.idx_metrics_events_user_id_timestamp`
- `metrics_events.idx_metrics_events_agent_id_timestamp`
- `billing_usage.idx_billing_usage_user_id_period_key`

Recommended additions:
- `agents.idx_agents_user_id_name` (uniqueness and quick lookup)
- `deployments.idx_deployments_user_id_created_at` (support/admin)
- `metrics_events.idx_metrics_events_deployment_id_timestamp` (deployment drill-down)
- `subscriptions.idx_subscriptions_provider_subscription_id`

Partial indexes (WHERE clauses) SHOULD be used where applicable to reduce index size:
- `idx_agents_user_id_name` uses `WHERE deleted_at IS NULL` to exclude soft-deleted agents.
- `idx_metrics_events_deployment_id_timestamp` uses `WHERE deployment_id IS NOT NULL`.

---

## 6) Access control requirements (Supabase RLS + Edge Functions)

### 6.1 General rule
Every query that reads/writes tenant-owned data MUST be protected by RLS policies that enforce:
1. `auth.uid()` is non-null (user is authenticated),
2. `resource.user_id = auth.uid()` before returning or modifying.

For client-side queries via Supabase client (`anon` key), RLS provides automatic tenant isolation.

For server-side operations (Edge Functions using `service_role` key), RLS is bypassed intentionally. These functions MUST still validate ownership in application code.

### 6.2 Server-only operations
The following MUST be implemented as Supabase Edge Functions using the `service_role` key and MUST NOT be callable directly from untrusted clients:
- deployment orchestration and provider API calls
- subscription webhook processing
- telemetry ingestion and signature verification
- cost calculation and aggregation writes
- secrets storage/injection into providers (via Supabase Vault)

### 6.3 Allowed client operations (MVP)
Client may call (authenticated via Supabase Auth, protected by RLS):
- `agents`: create, update, list, get, disable, delete (soft)
- `deployments`: list, get, activate (but provider calls must happen in Edge Functions)
- `billing_usage`: read own usage
- `metrics_events`: read own metrics (paginated)
- `subscriptions`: read own subscription

### 6.4 Preventing confused deputy
For any Edge Function that accepts `{ user_id, agent_id, deployment_id }` in the request:
- server MUST derive `user_id` from auth context (`auth.uid()` or JWT), not from client input
- server MUST verify `agent_id` belongs to that user
- if `deployment_id` provided, verify it belongs to `agent_id` and user

### 6.5 Telemetry ingestion authorization
Telemetry ingestion MUST NOT rely on user auth cookies/JWTs.
Instead it MUST use:
- deployment-scoped secret signature verification, AND
- cross-check ownership against DB (agent belongs to user; deployment belongs to agent).

Rejected telemetry SHOULD be recorded to `audit_log` with sanitized metadata.

---

## 7) Deletion and retention semantics

### 7.1 Soft delete (recommended)
For `agents`:
- set `deleted_at` and `status='disabled'`
- invocations MUST fail with `NOT_FOUND` or `UNAUTHORIZED` semantics (choose consistent behavior; prefer `NOT_FOUND` to avoid leakage)
- UI hides deleted agents by default (partial index on `deleted_at IS NULL`)

For related resources:
- deployments MAY be retained for audit for some time, but should be excluded from default lists if agent deleted (implementation choice).
- metrics_events retention policy continues independently.

### 7.2 Hard delete (optional)
If implementing hard deletes:
- ensure cascading deletion is safe and does not violate audit requirements
- ensure provider resources are deprovisioned best-effort

### 7.3 Retention jobs (pg_cron)
A **pg_cron** scheduled job SHOULD:
- delete `metrics_events` older than retention for that user's tier
- optionally compact metrics into daily/hourly aggregates (post-v1)
- keep `billing_usage` for at least 13 months (recommended) regardless of tier (or per tier)

Example pg_cron retention job:
```sql
-- Schedule daily at 03:00 UTC
SELECT cron.schedule('metrics-retention', '0 3 * * *', $$
  DELETE FROM metrics_events
  WHERE created_at < now() - interval '7 days'
    AND user_id IN (SELECT id FROM users WHERE subscription_tier = 'free');

  DELETE FROM metrics_events
  WHERE created_at < now() - interval '14 days'
    AND user_id IN (SELECT id FROM users WHERE subscription_tier = 'starter');

  DELETE FROM metrics_events
  WHERE created_at < now() - interval '30 days'
    AND user_id IN (SELECT id FROM users WHERE subscription_tier = 'pro');

  DELETE FROM metrics_events
  WHERE created_at < now() - interval '90 days'
    AND user_id IN (SELECT id FROM users WHERE subscription_tier = 'enterprise');
$$);
```

A **pg_cron** aggregation job SHOULD:
- compute and upsert `billing_usage` rows periodically.

Example pg_cron aggregation job:
```sql
-- Schedule hourly
SELECT cron.schedule('billing-aggregation', '0 * * * *', $$
  INSERT INTO billing_usage (user_id, period_key, period_start, period_end, totals, by_runtime, last_aggregated_at)
  SELECT
    user_id,
    to_char(timestamp, 'YYYY-MM') AS period_key,
    date_trunc('month', timestamp) AS period_start,
    date_trunc('month', timestamp) + interval '1 month' AS period_end,
    jsonb_build_object(
      'requests', SUM(requests),
      'tokens', SUM(llm_tokens),
      'compute_ms', SUM(compute_ms),
      'cost_usd_estimated', SUM(cost_usd_estimated)
    ),
    '{}'::jsonb,
    now()
  FROM metrics_events
  WHERE timestamp >= date_trunc('month', now())
  GROUP BY user_id, to_char(timestamp, 'YYYY-MM'), date_trunc('month', timestamp)
  ON CONFLICT (user_id, period_key) DO UPDATE SET
    totals = EXCLUDED.totals,
    by_runtime = EXCLUDED.by_runtime,
    last_aggregated_at = EXCLUDED.last_aggregated_at,
    updated_at = now();
$$);
```

---

## 8) Aggregation guidance (billing_usage)

### 8.1 Period standard
Choose one billing period scheme:
- Monthly calendar (recommended for v1 simplicity): `period_key = YYYY-MM`.
- Or subscription-aligned period (more accurate but more complex).

v1 recommendation:
- Use monthly `YYYY-MM` keys.
- If subscription billing periods differ, reconcile later.

### 8.2 Aggregation strategy
A server job (pg_cron or Edge Function cron) MUST:
- compute totals by scanning `metrics_events` in the period window
- write/update `billing_usage` idempotently for `(user_id, period_key)` using `ON CONFLICT ... DO UPDATE`
- record `last_aggregated_at`

Optimization (recommended):
- maintain incremental counters (e.g., per-day aggregates) to avoid scanning large raw tables repeatedly.

### 8.3 Idempotency
Aggregation MUST be safe to rerun:
- recompute and overwrite totals using `ON CONFLICT ... DO UPDATE`, OR
- use a checkpoint cursor and update incrementally with a stored watermark.

---

## 9) Deployment versioning strategy

### 9.1 Version assignment
`deployments.version` MUST be monotonic per agent.
Implementation options:
1. Use a subquery `SELECT COALESCE(MAX(version), 0) + 1 FROM deployments WHERE agent_id = $1` within a transaction with `SERIALIZABLE` or advisory lock.
2. Maintain `agents.next_deployment_version` counter (recommended for concurrency safety).

### 9.2 Concurrency
If two deployments start simultaneously:
- one MUST win version assignment
- the other MUST retry or fail with `CONFLICT` depending on desired UX
- The `UNIQUE(agent_id, version)` constraint provides a safety net.

v1 recommendation:
- prevent concurrent deploys per agent (`agents.status='deploying'` guard) to simplify.

---

## 10) Schema validation requirements

### 10.1 Enums
Store enums as PostgreSQL `ENUM` types or `text` with CHECK constraints; validate on write.

### 10.2 Limits
Enforce reasonable max sizes via CHECK constraints:
- `agents.name`: 64 chars
- `agents.description`: 4000 chars (optional)
- `agents.env_var_keys`: max 128 keys
- `metrics_events`: enforce payload size limits at ingestion (Edge Function validation)

### 10.3 Sanitization
`error_message` and `audit_log.metadata` MUST be sanitized:
- no secret values
- no raw provider credential strings
- no stack traces unless safely redacted and gated

---

## 11) Example query patterns (implementation hints)

### 11.1 Resolve user from identity
```sql
-- On first login, upsert user
INSERT INTO users (id, email)
VALUES (auth.uid(), 'user@example.com')
ON CONFLICT (id) DO NOTHING
RETURNING *;

-- Or simply select (RLS ensures only own row)
SELECT * FROM users WHERE id = auth.uid();
```

### 11.2 List agents
```sql
SELECT * FROM agents
WHERE user_id = auth.uid() AND deleted_at IS NULL
ORDER BY updated_at DESC;
```

### 11.3 List deployments for an agent
```sql
SELECT * FROM deployments
WHERE agent_id = $1 AND user_id = auth.uid()
ORDER BY created_at DESC
LIMIT 20;
```

### 11.4 Metrics time range for an agent
```sql
SELECT
  date_trunc('hour', timestamp) AS bucket,
  SUM(requests) AS requests,
  SUM(llm_tokens) AS tokens,
  SUM(compute_ms) AS compute_ms,
  SUM(cost_usd_estimated) AS cost
FROM metrics_events
WHERE agent_id = $1
  AND user_id = auth.uid()
  AND timestamp BETWEEN $2 AND $3
GROUP BY bucket
ORDER BY bucket;
```

### 11.5 Current period usage
```sql
SELECT * FROM billing_usage
WHERE user_id = auth.uid()
  AND period_key = to_char(now(), 'YYYY-MM');
```

---

## 12) Updated_at trigger

All mutable tables SHOULD use a trigger to automatically set `updated_at`:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_billing_usage_updated_at
  BEFORE UPDATE ON billing_usage FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## 13) Security checklist (data model)
- [ ] No plaintext secrets stored in any table (use Supabase Vault).
- [ ] `user_id` present on all tenant-owned tables for RLS enforcement.
- [ ] RLS enabled on all application tables with `auth.uid()` policies.
- [ ] Telemetry ingestion requires signature verification and ownership cross-check (Edge Function with `service_role`).
- [ ] Audit log captures deploy/billing/secrets actions without leaking secrets.
- [ ] Soft delete prevents data leaks and preserves auditability.
- [ ] Server-only mutations use `service_role` key (bypasses RLS intentionally).
- [ ] pg_cron handles retention and aggregation jobs.
- [ ] Supabase Vault stores all sensitive credentials.

---
