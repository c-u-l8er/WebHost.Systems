# ADR-0002: Use Supabase as the Control Plane Backend (PostgreSQL + Edge Functions)

- **Status:** Accepted (v1)
- **Date:** 2026-03-28
- **Supersedes:** ADR-0002 (Convex, 2026-01-21)
- **Owners:** webhost.systems engineering
- **Related docs:** `docs/spec/00_MASTER_SPEC.md`, `docs/spec/10_API_CONTRACTS.md`, `docs/spec/30_DATA_MODEL_SUPABASE.md`, `docs/spec/40_SECURITY_SECRETS_COMPLIANCE.md`

---

## 1) Context

webhost.systems is a multi-runtime AI agent platform. The system has a clear separation:

- **Data plane:** runtime providers where untrusted customer agent code executes (Cloudflare Workers/DO, AWS Bedrock AgentCore).
- **Control plane:** trusted backend responsible for:
  - authentication/authorization and tenant isolation,
  - agent + deployment orchestration,
  - secrets metadata and provider secret injection workflows,
  - invocation gateway routing + plan enforcement,
  - telemetry ingestion integrity and aggregation,
  - billing provider integration (checkout + webhook entitlement updates),
  - audit logging and operational tooling.

The control plane needs:
- strong consistency for critical operations (deploy versioning, entitlement updates, limit enforcement),
- near-real-time updates for UI (deployment status, usage updates),
- a straightforward developer experience that supports rapid iteration,
- good fit for TypeScript-first development,
- a path to implement server-only operations safely (provider API calls, webhook handlers, telemetry signature verification),
- mature relational querying for complex aggregation and reporting,
- built-in authentication that eliminates a separate auth provider dependency.

### 1.1 Migration context

The v1 control plane was originally designed around Convex (see superseded ADR-0002). After initial implementation experience, the team decided to migrate to Supabase for:
- native PostgreSQL with full SQL power (JOINs, window functions, CTEs) for aggregation and reporting,
- Row Level Security (RLS) as a declarative, auditable tenant isolation mechanism,
- built-in auth (Supabase Auth) eliminating the Clerk dependency,
- pg_cron for scheduled retention and aggregation jobs without external orchestration,
- Supabase Vault for secrets management,
- broader ecosystem and portability (standard PostgreSQL).

---

## 2) Decision

Use **Supabase** as the primary control plane backend for v1, including:

1. **PostgreSQL** (via Supabase) as the system of record for:
   - `users`, `agents`, `deployments`, `metrics_events`, `billing_usage`,
   - optional `subscriptions`, `audit_log`.

2. **Row Level Security (RLS)** as the primary tenant isolation mechanism:
   - all application tables have RLS enabled,
   - policies use `auth.uid()` to enforce per-user ownership,
   - server-side operations use `service_role` key to bypass RLS intentionally.

3. **Supabase Edge Functions** (Deno-based) as the server-side API implementation surface for:
   - deployment orchestration workflows,
   - telemetry ingestion and validation,
   - billing checkout and webhook processing,
   - metrics aggregation jobs (supplementing pg_cron).

4. **Supabase Auth** as the authentication provider:
   - replaces Clerk for user authentication,
   - `auth.uid()` maps directly to `users.id`,
   - supports social login, magic link, and email/password flows.

5. **Supabase Vault** for secrets storage:
   - provider API keys and credentials stored in `vault.secrets`,
   - application tables store only key names and vault references.

6. **pg_cron** for scheduled jobs:
   - metrics retention cleanup,
   - billing usage aggregation,
   - any periodic maintenance tasks.

7. **Supabase Realtime** MAY be used for live UI updates (deployment status, metrics) via PostgreSQL LISTEN/NOTIFY or Realtime subscriptions.

Supabase is the control plane implementation choice. It does not change the multi-runtime architecture; runtime providers remain Cloudflare (default) and AgentCore (premium/enterprise), behind a Runtime Provider Interface (RPI).

---

## 3) Rationale

### 3.1 Mature relational model
PostgreSQL provides full SQL expressiveness (JOINs, window functions, CTEs, partial indexes) that simplifies aggregation queries, reporting, and complex access patterns. The UNIQUE and CHECK constraints enforce data invariants at the database level.

### 3.2 Declarative tenant isolation via RLS
Row Level Security provides a declarative, auditable, and database-enforced tenant isolation layer. Every query is automatically filtered by `auth.uid()`, reducing the surface area for IDOR-style bugs compared to application-level ownership checks.

### 3.3 Integrated auth
Supabase Auth eliminates the need for a separate auth provider (Clerk), reducing vendor dependencies and simplifying the identity-to-database mapping (`auth.uid()` = `users.id`).

### 3.4 Built-in scheduled jobs
pg_cron enables retention policies and aggregation jobs to run directly in the database without external cron infrastructure or serverless scheduler setup.

### 3.5 Secrets management
Supabase Vault provides encrypted-at-rest secrets storage integrated with the database, avoiding the need for a separate secrets manager for provider credentials.

### 3.6 TypeScript developer experience
Supabase provides auto-generated TypeScript types from the database schema, a well-documented JS client library, and Edge Functions (Deno/TypeScript) for server-side logic. This maintains TypeScript-first development across the stack.

### 3.7 Portability
Standard PostgreSQL means the data layer is portable to any PostgreSQL host. Edge Functions can be replaced with any server-side runtime. There is no proprietary query language or data format lock-in.

### 3.8 Real-time UX
Supabase Realtime (backed by PostgreSQL LISTEN/NOTIFY) supports live UI updates for deployment status transitions, near-real-time metrics rollups, and invocation error visibility.

---

## 4) Alternatives considered

### 4.1 Convex (original v1 choice, now superseded)
**Pros:**
- cohesive data + server function model,
- built-in reactive subscriptions,
- fast initial prototyping.

**Cons:**
- limited query expressiveness (no JOINs, no window functions),
- access control is application-level only (no declarative RLS),
- vendor lock-in with proprietary data format and query language,
- requires separate auth provider (Clerk),
- no built-in secrets management or scheduled jobs.

### 4.2 Firebase
**Pros:**
- fast prototyping,
- built-in auth.

**Cons:**
- NoSQL limitations for aggregation,
- security rules can become complex and error-prone for multi-tenant workflows,
- no relational model.

### 4.3 Traditional Postgres + custom backend (e.g., Express/Fastify)
**Pros:**
- full control,
- mature ecosystem.

**Cons:**
- more infrastructure to operate,
- must build auth, realtime, and secrets management from scratch,
- slower initial velocity for an early-stage product.

### 4.4 "Runtime-first" approach: host control plane on a single provider (e.g., Cloudflare only)
**Pros:**
- fewer vendors,
- potentially simpler deployment story.

**Cons:**
- control plane requirements (webhooks, secure secret workflows, reliable aggregation) push toward a richer backend model,
- does not inherently provide the same DB + RLS ergonomics.

---

## 5) Consequences

### 5.1 Positive consequences
- Declarative tenant isolation via RLS reduces IDOR risk.
- Full SQL power for aggregation, reporting, and complex queries.
- Integrated auth eliminates Clerk dependency.
- pg_cron handles scheduled jobs without external infrastructure.
- Supabase Vault centralizes secrets management.
- Standard PostgreSQL ensures portability.
- Auto-generated TypeScript types from DB schema.

### 5.2 Negative consequences / tradeoffs
- Adds a vendor dependency (Supabase) in the control plane, though PostgreSQL itself is portable.
- RLS policies require careful design and testing to avoid overly permissive or restrictive rules.
- Edge Functions (Deno) have a different runtime than Node.js; some npm packages may need adaptation.
- Realtime subscriptions require explicit setup compared to Convex's automatic reactivity.

### 5.3 Neutral consequences
- The RPI and provider adapters remain necessary regardless of control plane backend choice.

---

## 6) Implementation notes (normative requirements)

These requirements apply because we chose Supabase; they are considered part of the "decision contract".

### 6.1 Access control (MUST)
- RLS MUST be enabled on all application tables.
- Every RLS policy MUST use `auth.uid()` to enforce tenant isolation.
- Server-side Edge Functions that need to bypass RLS MUST use the `service_role` key.
- Client-supplied `user_id` MUST be ignored for authorization decisions; `auth.uid()` is the sole source of identity.

### 6.2 Server-only sensitive operations (MUST)
The following MUST be implemented as Edge Functions using `service_role` and must never trust browser clients:
- runtime provider deploy operations,
- runtime provider secret injection (via Supabase Vault),
- telemetry ingestion and signature verification,
- billing webhook processing and tier updates,
- usage aggregation writes.

### 6.3 Immutability and state machines (MUST)
- Deployments are immutable except status/provider_ref/error fields.
- Agent `active_deployment_id` is the only routing pointer for invocations.
- State transitions MUST match `00_MASTER_SPEC.md` and `10_API_CONTRACTS.md`.

### 6.4 Telemetry ingestion integrity (MUST)
- Telemetry events MUST be authenticated (deployment-scoped signing) and cross-checked for ownership.
- Telemetry ingestion MUST be robust to retries (dedupe recommended via `idempotency_key` or `ON CONFLICT`).

### 6.5 Secrets handling (MUST)
- No plaintext secrets stored in application tables.
- Supabase Vault (`vault.secrets`) stores all sensitive credentials.
- No endpoint returns secret values.

### 6.6 Aggregation and limits (MUST)
- Limit enforcement MUST occur before provider invocation whenever possible.
- Aggregated `billing_usage` is derived from raw `metrics_events` and must be recomputable/idempotent.
- pg_cron SHOULD handle periodic aggregation and retention.

---

## 7) Security considerations specific to this decision

- RLS is the primary defense against cross-tenant data access; policies MUST be reviewed and tested thoroughly.
- Implement defensive patterns:
  - RLS policies on all tables (no table should have RLS disabled in production),
  - Edge Functions validate ownership even when using `service_role`,
  - centralized error normalization (no secrets in errors),
  - audit logging for privileged actions (deploy, secrets updates, webhook processing, telemetry rejects).
- Treat Supabase as "control plane only"; never run untrusted customer agent code within Supabase Edge Functions.
- Supabase Vault encryption keys are managed by the platform; rotate credentials periodically.

---

## 8) Migration / exit strategy (if Supabase is replaced later)

If future requirements or constraints motivate replacing Supabase:
- The system should remain portable because:
  - data model is standard PostgreSQL (tables, constraints, indexes, RLS),
  - API contracts are documented (request/response/error envelopes),
  - runtime adapters are defined via RPI and independent of Supabase specifics.

Migration plan (high-level):
1. Export PostgreSQL schema and data via `pg_dump`.
2. Re-implement Edge Functions as equivalent server-side handlers on the new platform.
3. Replace Supabase Auth with the new auth provider, mapping `auth.uid()` to the equivalent identity.
4. Replace Supabase Vault with the new secrets manager.
5. Replace pg_cron with the new scheduler.
6. Cut over UI and runtime telemetry endpoints once stable.

---

## 9) Decision acceptance criteria

This ADR is considered successfully implemented when:
- Control plane features (agent CRUD, deploy orchestration, telemetry ingestion, billing webhook processing, usage aggregation) are implemented as Edge Functions and SQL with correct RLS-based tenant isolation.
- No plaintext secrets exist in application tables (all in Supabase Vault).
- Telemetry and billing webhooks are integrity-protected and cannot be spoofed to alter usage or tier.
- The system can deploy and invoke at least one agent on Cloudflare end-to-end, and produce usage metrics in the dashboard.
- The architecture remains consistent with the multi-runtime strategy and RPI contract.
