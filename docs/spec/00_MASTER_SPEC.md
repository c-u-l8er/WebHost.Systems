# webhost.systems — MASTER ENGINEERING SPEC (v1)

> **SUPERSEDED IN PART — the data layer. Added 2026-08-15; the rest of this document stands.**
>
> This is a dated design record and has **not** been rewritten: rewriting it would fabricate a
> design review nobody performed. What it gets wrong is one layer, named here so it can be read
> around.
>
> **The shared-Supabase route was abandoned by Travis on 2026-07-30**, replaced by `studbook`
> (`studbook/docs/spec/README.md` — a spec with no implementation; do not build from it yet).
> Anything below that specifies Supabase tables, RLS policies, Supabase Auth or `amp.profiles`
> identity is describing a route that is no longer taken. `ampersand-supabase/` is **archived, not
> failed** — it still runs, and nothing migrates off it until studbook can hold the same data with
> the same guarantees.
>
> The blocker is one unruled question — where confidentiality comes from. See `CONFIDENTIALITY.md`
> and `THREAT_MODEL.md` in the repository root.
>
> **The product, API, UX and protocol design in this document are unaffected.** Read them.
>
> `REVISION_REGISTER.md` tracks what else in the tree still contradicts a decision already made.

> **Also corrected:** this document describes WebHost.Systems as a **Convex** backend. It is not,
> and never was in this tree — `WebHost.Systems/apps/web/package.json` depends on
> `@supabase/supabase-js`, with no Convex or Clerk dependency anywhere in the monorepo. The same
> wrong claim is currently live on `webhost.systems` and was in `AGENTS.md` until 2026-08-15.
Version: 1.1
Status: Implementation-ready draft
Audience: Engineering (primary), Product/Security (secondary)
Last updated: 2026-03-28

> Goal: This document is intended to be sufficient context for an engineer (or coding agent) to implement webhost.systems from scratch without needing additional specs.

---

## 0) Executive summary

webhost.systems is a multi-runtime AI agent deployment and hosting platform. It provides:

- a **control plane** (UI + APIs) for creating agents, deploying code, managing configuration/secrets, viewing logs/metrics, and billing;
- a **data plane** for executing agents on one of multiple runtime providers:
  - **Cloudflare Workers + Durable Objects** (default; global edge, strong economics; TypeScript-native),
  - **AWS Bedrock AgentCore** (premium/enterprise; long-running sessions, enterprise isolation and built-in tools ecosystem; **TypeScript-native** via `@aws-sdk/client-bedrock-agentcore` (runtime/control) and `bedrock-agentcore` (tools ecosystem, incl. Code Interpreter + Browser integrations)).

A third system, **Supabase (PostgreSQL DB + Edge Functions + Realtime + Auth)**, is used for control plane logic and dashboard automation—not primary agent hosting.

Core differentiator: **runtime portability under a single abstraction**, plus **first-class metering and limit enforcement**, delivered with a **TypeScript-first, end-to-end developer experience**.

---

## 1) Scope, goals, non-goals

### 1.1 Goals (MVP -> v1)
The platform MUST support:
1. **User auth** and per-tenant isolation for all data and actions.
2. **Agent CRUD**: create/edit/delete agents with runtime selection.
3. **Deployment pipeline**:
   - upload/pull code bundle,
   - validate and deploy to selected runtime provider,
   - maintain immutable deployment history,
   - support rollback (set active deployment).
4. **Invocation**:
   - provide a stable invocation API (HTTP/SDK-ready),
   - support both stateless and sessionful invocations (session id as opaque string),
   - optional streaming (SHOULD where feasible across both runtimes; MAY be emulated by the gateway when a provider does not support true streaming).
5. **Observability**:
   - per-agent and per-deployment metrics (requests, tokens, compute ms, errors),
   - logs access (at least basic; better with structured events).
6. **Billing & limits**:
   - subscription tiers,
   - plan enforcement (hard limit at MVP),
   - billing provider integration (checkout + webhook activation).
7. **Dashboard assistant** (optional but recommended):
   - can deploy agents and answer usage questions,
   - scoped to the authenticated user resources only,
   - MUST NOT run untrusted customer agent code.

### 1.2 Non-goals (explicit)
- Building an LLM provider (users bring their own model credentials or use runtime-native integrations).
- Running arbitrary customer containers on the control plane.
- Perfect cost accuracy at MVP (cost can be "estimated" until reconciled with provider billing exports).
- Team/org/roles/SCIM in MVP (can be post-MVP unless required).

### 1.3 Assumptions
- Control plane uses **Supabase** as primary database (PostgreSQL), backend functions (Edge Functions + PostgREST RPC), and realtime subscriptions (or an equivalent serverless backend; if substituted, preserve schema + invariants).
- Auth uses **Supabase Auth** (email + OAuth providers: Google, GitHub); provides JWT tokens, user management, and Row-Level Security (RLS) integration out of the box.
- Billing uses **LemonSqueezy** (or equivalent); spec assumes webhook-driven entitlement.
- Runtime providers initially: Cloudflare Workers/DO and AWS AgentCore.

---

## 2) Key decisions (ADR-style summaries)

### ADR-0001: Multi-runtime architecture
**Decision:** Support multiple runtime providers behind a single abstraction.
**Rationale:** Avoid lock-in, optimize for cost/global edge for most users, offer enterprise-grade long-running isolation for premium customers.
**Consequences:** Requires a Runtime Provider Interface (RPI), consistent telemetry schema, and deployment packaging that can target multiple runtimes.

### ADR-0002: Supabase for control plane
**Decision:** Use Supabase (PostgreSQL + Edge Functions + Realtime) for data + backend functions; optional dashboard assistant for automation.
**Rationale:** Full PostgreSQL power (transactions, RLS, foreign keys, pg_cron), built-in auth, realtime subscriptions, Edge Functions for server-only logic, Supabase Vault for encrypted secret storage. Single platform replaces what previously required Convex + Clerk.
**Constraint:** Supabase Edge Functions are not used for primary agent hosting due to runtime/time limits and differing execution model.

### ADR-0003: Secrets strategy
**Decision:** Do not store plaintext secrets in the primary database. Use **Supabase Vault** for encrypted secret storage and push secret values to provider secret mechanisms at deploy time.
**Rationale:** Reduce breach impact and align with best practices.

### ADR-0004: Usage and cost
**Decision:** Capture near-real-time usage events; compute **estimated cost** via provider-specific calculators at MVP; add reconciliation later.
**Rationale:** Enables limits, billing UX, and pricing iteration early.

### ADR-0005: Deployment immutability + active pointer
**Decision:** Deployments are immutable records; an agent has an `activeDeploymentId` pointer.
**Rationale:** Rollbacks, audits, reproducibility, and safer operations.

---

## 3) Glossary (canonical terms)

- **User**: authenticated account holder (Supabase Auth user).
- **Agent**: a logical AI service owned by a user; has a selected runtime provider and configuration.
- **Deployment**: immutable version of an agent published to a runtime provider.
- **Runtime Provider**: execution environment; initially `cloudflare` and `agentcore`.
- **Invocation**: a request to execute an agent (stateless or sessionful).
- **Session**: provider-specific stateful context; represented as opaque `sessionId`.
- **Control Plane**: dashboard + APIs + DB + billing + deployment orchestration.
- **Data Plane**: runtime execution environments.
- **Telemetry Event**: per-invocation metrics emitted from data plane to control plane.
- **Edge Function**: Supabase Edge Function (Deno-based); used for server-only control plane operations.
- **RLS**: Row-Level Security; PostgreSQL policy enforcement for tenant isolation.

---

## 4) System architecture

### 4.1 High-level components
1. **Web UI** (Vite + React)
   - Agents list/detail
   - Deploy flow
   - Logs/metrics view
   - Billing/plan view
2. **Auth provider** (Supabase Auth — email, Google OAuth, GitHub OAuth)
3. **Control plane backend** (Supabase: PostgreSQL + PostgREST + Edge Functions)
   - agent CRUD (PostgREST / RPC functions)
   - deployment orchestration (Edge Functions)
   - billing entitlement + enforcement (Edge Functions + pg_cron)
   - telemetry ingestion + aggregation (Edge Functions + pg_cron)
   - dashboard assistant (optional)
4. **Realtime** (Supabase Realtime — PostgreSQL LISTEN/NOTIFY)
   - Dashboard live updates for deployment status, metrics
5. **Runtime providers**
   - Cloudflare Workers + Durable Objects (TypeScript)
   - AWS Bedrock AgentCore (TypeScript; AWS SDK: `@aws-sdk/client-bedrock-agentcore`; tools SDK: `bedrock-agentcore`)
6. **Billing provider**
   - checkout sessions
   - webhooks for subscription lifecycle

### 4.2 Data plane vs control plane boundary (hard rule)
- Control plane:
  - stores metadata and non-secret config
  - coordinates deployments
  - authorizes invocations
  - aggregates usage/billing
- Data plane:
  - executes customer agent code
  - emits telemetry events
  - never has broad access to other tenants' data

### 4.3 Request flows (canonical)

#### Flow A — Create agent
1. UI calls control plane: `POST /rest/v1/rpc/create_agent`
2. Control plane creates `agents` row (status: `created`)
3. UI shows agent detail page

#### Flow B — Deploy agent
1. UI uploads bundle OR provides repo reference (MVP can start with uploaded bundle)
2. UI calls Edge Function: `POST /functions/v1/deploy`
3. Edge Function:
   - validates inputs (size, required files, allowed runtime)
   - creates immutable `deployments` row (status: `deploying`)
   - invokes runtime provider adapter to deploy
   - updates deployment status; sets `agents.active_deployment_id` on success

#### Flow C — Invoke agent
1. Client calls `POST /functions/v1/invoke/:agentId` (Edge Function gateway)
2. Edge Function:
   - authenticates/authorizes via Supabase Auth JWT
   - checks plan limits and agent status
   - routes to runtime provider invocation endpoint
3. Data plane runs agent, returns response (optionally streaming)
4. Data plane emits telemetry event to control plane ingestion endpoint

#### Flow D — Usage aggregation / billing
1. Telemetry events stored in `metrics_events` table (raw)
2. pg_cron scheduled job aggregates into `billing_usage` by user + period
3. UI reads `billing_usage` and shows limits/overages

---

## 5) Product requirements (engineering-focused)

### 5.1 Agent management
MUST:
- Create agent with:
  - `name` (unique per user, or unique within user namespace),
  - `description` (optional),
  - `framework` (enum/string; informational at MVP),
  - `runtime_provider` (`cloudflare` | `agentcore`),
  - `env_var_keys` (list of keys; values handled separately via Supabase Vault),
  - `status` (`created` | `deploying` | `active` | `error` | `disabled`).
- Edit agent metadata (name/description/framework/default runtime settings).
- Disable an agent (invocations rejected).

SHOULD:
- "Clone agent" (copy config + latest deployment reference).

### 5.2 Deployments
MUST:
- Keep immutable deployment history.
- Store deployment inputs:
  - `version` (semver or monotonic int),
  - `commit_hash` (optional),
  - `runtime_provider`,
  - provider-specific reference fields,
  - timestamps, status transitions, and error messages.
- Support rollback by switching `active_deployment_id`.

### 5.3 Invocation semantics
MUST:
- Provide a single canonical request shape for invocations:
  - `agentId`
  - `input` (see section 7)
  - `sessionId` (optional)
  - `metadata` (optional; tracing info)
- Return:
  - `output` (text + optional structured data)
  - `sessionId` (if created/continued)
  - `usage` (tokens/compute/time/toolCalls if available)
  - `traceId`

MAY:
- Support streaming responses via SSE or chunked fetch (recommended).

### 5.4 Observability
MUST:
- Capture and display:
  - requests count
  - token usage (actual if provider reports; otherwise estimated)
  - compute ms
  - errors count (with category)
  - runtime provider
  - time series over selectable windows
- Support per-agent and per-deployment views.

### 5.5 Billing and enforcement
MUST:
- Support subscription tiers that gate:
  - max requests per period
  - token budget per period
  - compute budget per period
  - log retention days
  - access to AgentCore runtime (typically higher tiers)
- Enforce limits at request-time (hard stop at MVP).
- Integrate billing provider:
  - create checkout
  - handle webhook events
  - update `users.subscription_tier` and entitlements

---

## 6) Data model (PostgreSQL) — required schema + invariants

> The schema below is normative. Field names can vary, but semantics and invariants must be preserved. Full DDL is in `30_DATA_MODEL.md`.

### 6.1 `users`
Fields:
- `id` (UUID, PK, default `auth.uid()`)
- `email`
- `name`
- `subscription_tier` (`free` | `starter` | `pro` | `enterprise`)
- `default_runtime_provider` (`cloudflare` | `agentcore`)
- `created_at`, `updated_at`

Indexes:
- by `email` (unique)

Invariants:
- One user row per Supabase Auth identity (linked via `auth.uid()`).
- RLS policy: users can only read/update their own row.

### 6.2 `agents`
Fields:
- `id` (UUID, PK)
- `user_id` (FK -> `users`)
- `name`
- `description` (optional)
- `framework` (string)
- `runtime_provider` (`cloudflare` | `agentcore`)
- `active_deployment_id` (FK -> `deployments`, optional)
- `status` (`created` | `deploying` | `active` | `error` | `disabled`)
- `env_var_keys` (text[])
- `provider_config` (JSONB)
- `created_at`, `updated_at`, `last_deployed_at` (optional)

Indexes:
- by `user_id`
- by `(user_id, name)` unique

Invariants:
- `user_id` must exist.
- `active_deployment_id` (if present) must reference a deployment for this agent.
- RLS policy: `auth.uid() = user_id`.

### 6.3 `deployments`
Fields:
- `id` (UUID, PK)
- `agent_id` (FK -> `agents`)
- `user_id` (FK -> `users`, denormalized)
- `version` (monotonic per agent)
- `runtime_provider`
- `status` (`deploying` | `active` | `failed` | `rolled_back`)
- `commit_hash` (optional)
- `artifact` (JSONB)
- `provider_ref` (JSONB)
- `error_message` (optional)
- `deployed_at`, `finished_at` (optional)
- `deployed_by_user_id` (FK -> `users`)
- `created_at`

Indexes:
- by `(agent_id, created_at)`
- by `(agent_id, version)` unique

Invariants:
- Deployment records are immutable after creation except status/error fields and provider_ref.
- RLS policy: `auth.uid() = user_id`.

### 6.4 `metrics_events` (raw telemetry events)
Fields:
- `id` (UUID, PK)
- `user_id`, `agent_id`, `deployment_id`
- `runtime_provider`
- `timestamp_ms` (bigint)
- `requests` (int), `llm_tokens` (int), `compute_ms` (int)
- `errors` (int), `error_class`
- `provider_details` (JSONB)
- `cost_usd_estimated` (numeric)
- `trace_id`
- `created_at`

Indexes:
- by `(agent_id, timestamp_ms)`
- by `(user_id, timestamp_ms)`

### 6.5 `billing_usage` (aggregated)
Fields:
- `id` (UUID, PK)
- `user_id` (FK -> `users`)
- `period_key` (e.g., `2026-01`)
- totals: `total_requests`, `total_tokens`, `total_compute_ms`, `total_cost_usd_estimated`
- per-runtime breakdown (JSONB)
- `paid` (boolean)
- `invoice_id` (optional)
- `created_at`, `updated_at`

Indexes:
- by `(user_id, period_key)` unique

---

## 7) Canonical invocation protocol (normative)

### 7.1 Request shape
`InvokeRequest` MUST be supported by all runtime adapters:

- `input`:
  - `messages`: array of `{ role: 'system'|'user'|'assistant'|'tool', content: string }`
  - OR `prompt: string` (if provided, control plane converts to messages)
- `sessionId?`: string (opaque)
- `options?`:
  - `maxSteps?`: number
  - `temperature?`: number
  - `toolPolicy?`: allow/deny list (optional)
- `metadata?`:
  - `traceId?`
  - `client?` (sdk version, etc.)

### 7.2 Response shape
`InvokeResponse`:
- `output`:
  - `text`: string
  - `messages?`: optional transcript
- `sessionId?`: string
- `usage`:
  - `tokens?`
  - `computeMs?`
  - `toolCalls?`
- `traceId`: string
- `error?`: normalized error object if failed

### 7.3 Error normalization
All errors MUST be mapped to:
- `code`: `UNAUTHENTICATED` | `UNAUTHORIZED` | `NOT_FOUND` | `LIMIT_EXCEEDED` | `DEPLOYMENT_FAILED` | `RUNTIME_ERROR` | `INVALID_REQUEST`
- `message`: safe, user-displayable
- `details?`: internal-only; never return secrets

---

## 8) Runtime Provider Interface (RPI)

### 8.1 Required capabilities
Every runtime provider adapter MUST implement:
- `deploy(deployInput) -> deployOutput`
- `invoke(invokeInput) -> invokeOutput` (optionally streaming)
- `healthcheck() -> status`
- `estimateCost(usage) -> costUsd` (MVP can be approximate)
- `emitTelemetry(event)` or ensure data plane emits telemetry to control plane

### 8.2 Deploy contract
Deploy input MUST include:
- agent identity (agentId, userId)
- deployment identity (deploymentId/version)
- code artifact reference
- non-secret env config
- secret keys list (values already stored in provider secret store)

Deploy output MUST include:
- provider reference sufficient to invoke
- any session/state configuration needed
- status and normalized error (if failed)

### 8.3 Invoke contract
Invoke MUST:
- validate deployment is active/allowed
- accept `sessionId?` and return `sessionId?`
- return usage metrics if possible
- never block indefinitely; enforce provider runtime max and internal timeouts

---

## 9) Cloudflare runtime (implementation spec)

### 9.1 Execution model
- Worker receives invocation requests and routes them to a Durable Object instance for stateful sessions (if needed).
- DO stores conversation history and session state.
- Worker/DO calls model provider (either via BYOK key or Cloudflare AI if chosen).

### 9.2 Session mapping
- `sessionId` maps to DO id (opaque string to client).
- If `sessionId` absent, create a new DO id and return it.

### 9.3 Telemetry
- DO MUST send telemetry to control plane ingestion endpoint after each invocation:
  - tokens (estimated if needed)
  - computeMs (wall time)
  - errors (0/1)
  - provider-specific counters

### 9.4 Secrets
- Secrets are stored as Worker secrets bound at deploy time.
- Control plane must set secrets via Cloudflare API; never persist plaintext.

---

## 10) AWS Bedrock AgentCore runtime (implementation spec)

### 10.1 Execution model
- Control plane deploys agent runtime resources via AWS SDK.
- Invocations use the AgentCore runtime invoke APIs.
- Optional: integrate AgentCore tools SDK (code interpreter, browser tools) for premium features.

### 10.2 Session mapping
- `sessionId` corresponds to AgentCore runtime session id.
- If absent, create/init a session as required by AgentCore patterns and return it.

### 10.3 Telemetry
- Capture:
  - session duration
  - tool invocations
  - tokens (provider-reported if available)
  - errors
- Emit normalized telemetry events to control plane.

### 10.4 Secrets
- Use AWS-native secret injection (e.g., Secrets Manager) or AgentCore secret mechanism.
- Control plane should store references, not values.

---

## 11) Control plane API surface (normative)

> Control plane is implemented via Supabase: PostgREST for CRUD, RPC functions for business logic, Edge Functions for server-only operations.

### 11.1 Auth
- `auth.getUser()` -> user profile + tier (via Supabase Auth JWT + `users` table)

### 11.2 Agents
- `agents.create({ name, description?, framework, runtime_provider, env_var_keys })` — RPC function
- `agents.update({ agent_id, ...fields })` — RPC function
- `agents.list()` — PostgREST query (RLS-filtered)
- `agents.get({ agent_id })` — PostgREST query (RLS-filtered)
- `agents.disable({ agent_id })` — RPC function
- `agents.delete({ agent_id })` — RPC function (soft delete; should also revoke provider resources if possible)

### 11.3 Deployments
- `deployments.createAndDeploy({ agent_id, artifact_ref, commit_hash?, version? })` — Edge Function
- `deployments.list({ agent_id })` — PostgREST query (RLS-filtered)
- `deployments.rollback({ agent_id, deployment_id })` — Edge Function
- `deployments.getLogs({ deployment_id })` — RPC function (can be stubbed in MVP)

### 11.4 Invocation gateway
- `invoke({ agentId, input, sessionId?, options?, metadata? })` — Edge Function
- MUST:
  - authorize user (via Supabase Auth JWT)
  - check entitlements and limits
  - route to active deployment's runtime provider adapter

### 11.5 Telemetry ingestion
- `metrics.report(event)` — Edge Function (authenticated with shared secret or signed token from runtime)
- MUST validate:
  - event attribution
  - prevent spoofing (HMAC signature or runtime-specific auth)

### 11.6 Billing
- `billing.createCheckout({ tier })` — Edge Function
- `billing.handleWebhook(payload)` — Edge Function (server-only)
- `billing.getUsage({ period? })` — RPC function

---

## 12) Plan limits and enforcement (normative)

### 12.1 Limit types
- requests per billing period
- tokens per billing period
- compute ms per billing period
- runtime access (AgentCore gated)

### 12.2 Enforcement points
- At invocation time in Edge Function gateway:
  - read `billing_usage` current period (or a fast cached counter)
  - reject with `LIMIT_EXCEEDED` when over limit
- At deploy time:
  - enforce runtime gating (e.g., free tier cannot deploy to AgentCore)

### 12.3 Overages (post-MVP option)
- Start with hard-stop.
- Later add pay-as-you-go and reconciled billing.

---

## 13) Security requirements (implementation-grade)

### 13.1 Tenant isolation
MUST:
- Every control plane query/mutation uses RLS policies enforcing `auth.uid() = user_id`.
- Runtime provider resources are namespaced per user (naming convention + tags).

### 13.2 Secrets handling
MUST:
- Never log secret values.
- Never store plaintext secrets in PostgreSQL tables (use Supabase Vault for encrypted storage).
- Provide secret rotation workflow (at least manual replace in UI).

### 13.3 Telemetry integrity
MUST:
- Telemetry endpoint rejects unauthenticated events.
- Use one of:
  - per-deployment HMAC key
  - signed JWT minted by control plane and embedded in runtime config
  - provider identity validation (where feasible)

### 13.4 Abuse and safety
SHOULD:
- Rate limit invocation endpoint per user and per agent.
- Validate payload sizes; prevent prompt bombing.

### 13.5 Supply chain
SHOULD:
- Validate uploaded bundles (size limits, file allowlist).
- Optional: scan dependencies post-MVP.

---

## 14) Observability and logging

### 14.1 Logs
MVP MUST:
- record deployment failures and statuses
- show last N invocation errors per agent (can be from metrics events)

SHOULD:
- store structured logs in an external store with retention policies

### 14.2 Tracing
MVP SHOULD:
- generate a `traceId` for each invocation
- include `traceId` in telemetry events and UI

---

## 15) Build/deploy packaging (MVP design)

This section defines how an **uploaded bundle** becomes a runnable deployment on each runtime provider. The v1 goal is: users upload one bundle format, and the control plane produces the correct runtime-specific artifact (Worker bundle vs AgentCore container image).

### 15.1 Artifact types (control-plane inputs)
- `uploaded_bundle` (v1 primary): zip/tar containing:
  - `agent.config.json` (required)
  - entrypoint file (required; referenced by `agent.config.json`)
  - source and dependencies required to build/run the agent
- `repo_ref` (optional/post-MVP): `{ githubUrl, ref }`

### 15.2 Runtime-specific build targets (what the control plane produces)

#### 15.2.1 Cloudflare target (Worker bundle)
For `runtime=cloudflare`, the control plane produces:
- a Worker script bundle suitable for deployment to Cloudflare Workers
- Durable Object bindings (if sessionful)
- secret bindings (telemetry signing key + user secrets) injected via Cloudflare secret mechanisms

#### 15.2.2 AgentCore target (container image pipeline)
For `runtime=agentcore`, the control plane produces:
- an OCI container image that implements the `invoke/v1` handler contract
- pushes the image to a registry (e.g., ECR) and deploys AgentCore runtime referencing the container image URI
- injects environment variables (telemetry signing key + user secrets) via AgentCore Runtime environment variable injection (v1 default)

Key v1 implication:
- Even though the user uploads a zip/tar, AgentCore deployment is container-based; the platform MUST provide a deterministic build pipeline that converts the bundle into a runnable container artifact.

### 15.3 Required manifest (`agent.config.json`)
Fields:
- `name` (optional; informational)
- `entrypoint` (e.g., `src/index.ts`)
- `runtime` (`cloudflare` | `agentcore`)
- `protocol` (`invoke/v1`)
- `env`:
  - `requiredKeys`: string[]
  - `optionalKeys`: string[]
- `capabilities`:
  - `streaming`: boolean
  - `tools`: boolean
- `agentcore` (optional, only meaningful when `runtime=agentcore`):
  - `container` (optional):
    - `port` (optional; default chosen by platform)
    - `healthcheckPath` (optional; default chosen by platform)
  - `lifecycle` (optional):
    - `idleTimeoutSeconds` (optional)
    - `maxLifetimeSeconds` (optional)
  - `network` (optional):
    - `mode` (optional; platform-defined default)

Notes:
- The platform MAY extend this schema over time; additive fields are allowed.
- The platform MUST reject manifests that claim `runtime=agentcore` but also require Cloudflare-only bindings (and vice versa).

### 15.4 AgentCore build pipeline (v1 normative behavior)
When deploying `runtime=agentcore` from an `uploaded_bundle`, the control plane MUST:
1. Validate and safely extract the archive (see security rules in the security spec).
2. Build the user code into a Node.js 20 compatible artifact (TypeScript compile/bundle as applicable).
3. Generate or include a thin HTTP wrapper that:
   - accepts an `invoke/v1` request payload (messages/prompt + sessionId + metadata),
   - calls the user entrypoint,
   - returns a JSON response containing at least `output.text`, and optionally usage fields.
4. Build an OCI image containing the runtime wrapper + built user artifact.
5. Push the image to a registry and record the resulting image URI in provider deployment configuration.
6. Create/update the AgentCore runtime referencing that container image artifact.
7. Inject environment variables (telemetry + user secrets) at deploy/update time using provider mechanisms.

The control plane MUST treat this pipeline as idempotent per deploymentId (retries must not create inconsistent provider state).

### 15.5 Validation rules (MUST)
MUST:
- enforce max artifact size (compressed and extracted) and max file count
- enforce required files present:
  - `agent.config.json` exists and parses
  - `entrypoint` exists
- enforce runtime compatibility:
  - `agent.config.json.runtime` matches the selected deployment runtime
  - `agent.config.json.protocol` is supported (`invoke/v1`)
- enforce archive safety:
  - reject path traversal entries and unsafe symlinks
- enforce AgentCore container pipeline prerequisites when `runtime=agentcore`:
  - build step succeeds deterministically
  - produced container image includes the wrapper and built entrypoint artifact
  - healthcheck/port expectations are satisfied (platform-defined)
- enforce Cloudflare deployment prerequisites when `runtime=cloudflare`:
  - bundle size and bindings are within provider constraints

SHOULD:
- produce actionable error messages on validation/build failures (sanitized, no secrets)
- keep build outputs deterministic (same input bundle + config => same build artifact hash), where practical

---

## 16) Dashboard assistant (optional module)

### 16.1 Purpose
A control-plane agent that can:
- deploy/redeploy based on user instructions,
- summarize usage,
- explain errors from deployment logs/metrics,
- recommend runtimes.

### 16.2 Constraints
MUST:
- only access the authenticated user's resources (enforced by RLS)
- never execute user agent bundles
- never expose secrets

---

## 17) Testing strategy (minimum viable)

### 17.1 Unit tests
- RPI adapters: deploy/invoke error mapping, request/response normalization
- limit checks and billing period calculations
- schema invariants helpers

### 17.2 Integration tests
- deploy to Cloudflare in a test account and invoke
- telemetry event ingestion and aggregation
- billing webhook flow (mocked provider payloads)

### 17.3 End-to-end (E2E)
- user signup
- create agent -> deploy -> invoke -> view metrics -> upgrade tier

---

## 18) Milestones (implementation plan)

### Phase 1 — Control plane foundation
- Supabase Auth integration
- PostgreSQL schema + RLS policies + CRUD functions
- Basic dashboard UI (Vite + React)
- Billing tier model stub (no payment yet)

### Phase 2 — Cloudflare runtime
- Cloudflare deploy adapter
- Invocation gateway routing to Cloudflare (Edge Function)
- Telemetry ingestion from DO/Worker
- Usage UI

### Phase 3 — Billing + enforcement
- Checkout + webhooks (Edge Functions)
- Limit enforcement on invoke and deploy
- Retention policies (pg_cron jobs)

### Phase 4 — AgentCore runtime
- AgentCore deploy/invoke adapter (TypeScript)
- Runtime gating by tier
- Telemetry normalization

### Phase 5 — Polish / assistant / reliability
- dashboard assistant tools
- improved logs
- alerts/notifications (post-MVP)

---

## 19) Open questions (must be answered before final sign-off)
1. **Public agents**: Are invocations always authenticated, or will agents optionally be publicly callable (API keys)?
2. **Model strategy**: BYOK only, or do you provide a hosted model option?
3. **Streaming**: Is streaming required for v1?
4. **Teams/orgs**: Do you need organizations and roles now?
5. **Artifact input**: Upload-only for MVP, or GitHub integration required?
6. **Compliance**: Any required compliance targets (SOC2, HIPAA) for enterprise roadmap?

---

## 20) Acceptance criteria (definition of done for v1)
The implementation is considered v1-complete when:
- A user can sign up (via Supabase Auth), create an agent, deploy to Cloudflare, invoke it, and see metrics in the dashboard.
- A paid tier user can deploy to AgentCore (if enabled) and invoke successfully.
- Limits are enforced reliably and errors are normalized.
- No plaintext secrets are stored in the primary database (Supabase Vault used for encrypted storage).
- Deployments are immutable and rollback works.
- Telemetry events are authenticated and attributable to user/agent/deployment.
- RLS policies enforce tenant isolation on every table.
