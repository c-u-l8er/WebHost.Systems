# webhost.systems — Data Model (Convex) & Access Control (v1)
Version: 1.0  
Status: Implementation-ready  
Last updated: 2026-01-21

This document defines the **normative Convex data model** for webhost.systems, including:
- required tables and fields,
- indexes,
- invariants and state machines,
- access control rules for queries/mutations/actions,
- retention and deletion semantics,
- example query patterns and aggregation guidance.

Normative language: MUST, MUST NOT, SHOULD, MAY.

---

## 1) Design goals

### 1.1 Goals
The data model MUST support:
- strong tenant isolation (per-user ownership),
- immutable deployment history with rollback,
- auditable changes to sensitive operations (deploy, billing, secrets),
- efficient listing and time-range metrics queries,
- usage aggregation by billing period,
- multi-runtime metadata (Cloudflare + AgentCore),
- idempotent operations (deploy, telemetry ingestion).

### 1.2 Non-goals
- Teams/orgs/roles in v1 (single-owner resources only).
- Perfect cost reconciliation (store “estimated cost” until provider billing exports exist).

---

## 2) Cross-cutting conventions

### 2.1 IDs and references
- All IDs are Convex document ids (opaque strings).
- Reference fields MUST store Convex ids (e.g., `userId`, `agentId`), not external ids.

### 2.2 Time
- Store times as integer unix ms (`number`) in DB for efficient comparisons and bucketing.
- Convert to RFC3339 only at API boundaries (UI/API layer).

Required time fields:
- `createdAtMs` on all top-level entities.
- `updatedAtMs` where mutable (users, agents, billingUsage, subscriptions).

### 2.3 Immutability rules
- `deployments` are immutable except for:
  - `status`,
  - `providerRef` (once known),
  - `errorMessage`,
  - `finishedAtMs`.
- `metricsEvents` are append-only (never update; only delete via retention policy jobs).
- `auditLog` is append-only.

### 2.4 Multi-runtime modeling
- Use `runtimeProvider` as the canonical selector: `"cloudflare" | "agentcore"`.
- Store runtime-specific config in a tagged union:
  - `provider.cloudflare` object (nullable)
  - `provider.agentcore` object (nullable)
- Exactly one provider object MUST be non-null for a given agent/deployment where applicable.

### 2.5 “Active” pointer
- `agents.activeDeploymentId` points to the currently active deployment (nullable if none).
- Rollback is implemented by switching `activeDeploymentId` to a prior deployment (that is in a valid state).

---

## 3) Tables (normative)

> Naming is normative for this spec. If you rename, preserve semantics, indexes, and invariants.

### 3.1 `users`
Represents the tenant owner.

Fields (required unless marked optional):
- `_id`
- `clerkId` (string, unique)
- `email` (string)
- `name` (string, optional)
- `subscriptionTier` (enum: `free | starter | pro | enterprise`)
- `defaultRuntimeProvider` (enum: `cloudflare | agentcore`)
- `createdAtMs` (number)
- `updatedAtMs` (number)

Recommended fields:
- `billingCustomerId` (string, optional; from billing provider)
- `disabled` (boolean, optional; default false)

Indexes:
- `by_clerkId` on `clerkId` (MUST)
- `by_email` on `email` (SHOULD if email lookup needed)

Invariants:
- One row per `clerkId`.
- `subscriptionTier` MUST be set (default `free`).

Access control:
- User can read their own user row.
- Mutations to `subscriptionTier` MUST be server-only (webhook or privileged admin).

---

### 3.2 `agents`
Logical agent entity owned by a user.

Fields:
- `_id`
- `userId` (id -> `users`)
- `name` (string; uniqueness policy recommended: unique per user)
- `description` (string, optional)
- `framework` (string; informational in v1)
- `runtimeProvider` (enum: `cloudflare | agentcore`)
- `status` (enum: `created | deploying | active | error | disabled`)
- `activeDeploymentId` (id -> `deployments`, optional)
- `envVarKeys` (string[]; keys only, never values)
- `providerConfig` (object):
  - `cloudflare` (nullable):
    - `workerName` (string, optional)
    - `workerUrl` (string, optional)
    - `durableObjectNamespace` (string, optional)
    - `durableObjectId` (string, optional)
  - `agentcore` (nullable):
    - `agentRuntimeArn` (string, optional)
    - `runtimeId` (string, optional)
    - `region` (string, optional)
    - `vCpu` (number, optional)
    - `memoryMb` (number, optional)
- `createdAtMs` (number)
- `updatedAtMs` (number)
- `lastDeployedAtMs` (number, optional)
- `lastInvocationAtMs` (number, optional) — optional optimization for UI

Recommended fields:
- `deletedAtMs` (number, optional) — tombstone instead of hard delete (recommended)
- `invokePolicy` (object, optional; post-v1):
  - `visibility`: `private | public`
  - `apiKeyId`: id -> `apiKeys` (optional)

Indexes:
- `by_userId` on `userId` (MUST)
- `by_userId_name` on (`userId`, `name`) (SHOULD; enforce uniqueness)
- `by_activeDeploymentId` on `activeDeploymentId` (MAY; useful for reverse lookup)

Invariants:
- `userId` MUST exist.
- If `activeDeploymentId` is set:
  - it MUST reference a deployment with `deployments.agentId == agents._id`,
  - the deployment SHOULD be `status=active` (or at least not `failed`).
- `providerConfig.cloudflare` MUST be non-null when `runtimeProvider=cloudflare` (once deployed), and `providerConfig.agentcore` MUST be null (and vice versa). During `created` state, both may be null.

Access control:
- Only the owning user may read/write agent rows (except server-side billing/deploy workflows).
- Changing `runtimeProvider` MUST be gated by entitlements (tier check).
- Agent deletion SHOULD be soft-delete with `deletedAtMs` set; invocations MUST fail for deleted/disabled agents.

State machine (normative):
- `created` -> `deploying` when a new deployment begins
- `deploying` -> `active` when deployment succeeds and becomes active
- `deploying` -> `error` when deployment fails
- any -> `disabled` via manual disable
- `disabled` -> `active` (optional “enable”) if there is an active deployment
- `error` -> `deploying` on redeploy attempt

---

### 3.3 `deployments`
Immutable deployment record.

Fields:
- `_id`
- `userId` (id -> `users`) — denormalized for fast auth checks (RECOMMENDED)
- `agentId` (id -> `agents`)
- `version` (number; monotonic per agent)
- `runtimeProvider` (enum: `cloudflare | agentcore`)
- `status` (enum: `deploying | active | failed | rolled_back`)
- `commitHash` (string, optional)
- `artifact` (object):
  - `type`: `uploaded_bundle | repo_ref`
  - `uploaded_bundle` (optional object):
    - `uploadId` (string)
    - `checksum` (string)
    - `sizeBytes` (number)
  - `repo_ref` (optional object):
    - `githubUrl` (string)
    - `ref` (string)
- `manifest` (object, optional but recommended):
  - parsed `agent.config.json` subset: `protocol`, `entrypoint`, `capabilities`, declared env keys
- `providerRef` (object):
  - `cloudflare` (nullable):
    - `workerUrl` (string, optional)
    - `durableObjectId` (string, optional)
  - `agentcore` (nullable):
    - `agentRuntimeArn` (string, optional)
    - `runtimeId` (string, optional)
    - `region` (string, optional)
- `errorMessage` (string, optional; sanitized)
- `logsRef` (object, optional):
  - pointer to external log store OR embedded small log excerpt
- `createdAtMs` (number)
- `deployedAtMs` (number, optional) — when provider confirms active
- `finishedAtMs` (number, optional) — when deployment completed (success/failure)
- `deployedByUserId` (id -> `users`) — who triggered deploy

Recommended fields:
- `idempotencyKey` (string, optional) — to dedupe deploy retries
- `telemetryAuthRef` (object, optional; reference only, never plaintext):
  - e.g., `keyId` or `secretName` depending on provider

Indexes:
- `by_agentId_createdAt` on (`agentId`, `createdAtMs`) (MUST)
- `by_agentId_version` on (`agentId`, `version`) (MUST)
- `by_userId_createdAt` on (`userId`, `createdAtMs`) (SHOULD; helpful for admin/support views)
- `by_status_createdAt` on (`status`, `createdAtMs`) (MAY; for ops dashboards)

Invariants:
- `agentId` MUST exist and belong to `userId`.
- `version` MUST be unique per `agentId` and monotonic increasing.
- `status` transitions:
  - `deploying` -> `active` OR `failed`
  - `active` may become `rolled_back` when another deployment becomes active (optional bookkeeping)
- `providerRef` must align with `runtimeProvider` (only one non-null once deployed).

Access control:
- User can list and read deployments for their own agents.
- Only server-side code (or authorized user action) can create deployments.
- `providerRef`, `status`, and `errorMessage` updates MUST be server-only.

---

### 3.4 `metricsEvents` (raw telemetry, append-only)
Stores per-invocation telemetry events. This is the “source of truth” for usage aggregation.

Fields:
- `_id`
- `userId` (id -> `users`) (required)
- `agentId` (id -> `agents`) (required)
- `deploymentId` (id -> `deployments`, optional but strongly recommended)
- `runtimeProvider` (enum: `cloudflare | agentcore`)
- `timestampMs` (number)
- `requests` (number; usually 1)
- `llmTokens` (number; provider-reported or estimated)
- `computeMs` (number; wall time or billed compute)
- `errors` (number; 0/1 in typical case)
- `errorClass` (enum: `auth | limit | runtime | tool | unknown`, optional)
- `traceId` (string, optional)
- `provider` (object):
  - `cloudflare` (nullable):
    - `durableObjectOps` (number, optional)
    - `workersAICalls` (number, optional)
  - `agentcore` (nullable):
    - `sessionDurationMs` (number, optional)
    - `toolInvocations` (number, optional)
    - `browserInteractions` (number, optional)
- `costUsdEstimated` (number) — MUST be present (can be 0 if unknown, but prefer estimate)
- `createdAtMs` (number) — ingestion time

Recommended fields:
- `bucketKey` (string, optional) — e.g., `YYYY-MM-DD` for retention/aggregation partitioning
- `ingestSource` (enum, optional): `cloudflare | agentcore | adapter`
- `ingestDeploymentKeyId` (string, optional) — internal only; for debugging signature validation

Indexes:
- `by_userId_timestamp` on (`userId`, `timestampMs`) (MUST)
- `by_agentId_timestamp` on (`agentId`, `timestampMs`) (MUST)
- `by_deploymentId_timestamp` on (`deploymentId`, `timestampMs`) (SHOULD if deploymentId always present)
- `by_userId_bucketKey` on (`userId`, `bucketKey`) (MAY; helpful for retention sweeps)

Invariants:
- Events are append-only.
- `userId` and `agentId` MUST match actual ownership at the time of ingestion:
  - control plane MUST validate that `agents.userId == userId`.
- If `deploymentId` is present:
  - control plane MUST validate `deployments.agentId == agentId` and `deployments.userId == userId`.

Access control:
- Users can query aggregated views derived from metrics; direct raw access MAY be allowed but SHOULD be restricted:
  - If exposing raw events, ensure tenant checks and pagination limits.
- Inserts into `metricsEvents` MUST be server-only via telemetry ingestion endpoint with signature verification.

Retention:
- Raw events SHOULD be retained by tier:
  - free: 7 days
  - starter: 14 days
  - pro: 30 days
  - enterprise: 90+ days (or configurable)
- Aggregated usage MUST be retained longer (see `billingUsage`).

---

### 3.5 `billingUsage` (aggregated usage per billing period)
Stores per-user aggregate usage for a billing period (e.g., monthly).

Fields:
- `_id`
- `userId` (id -> `users`)
- `periodKey` (string) — e.g., `2026-01` (YYYY-MM) for monthly billing; choose one standard
- `periodStartMs` (number)
- `periodEndMs` (number)
- `totals` (object):
  - `requests` (number)
  - `tokens` (number)
  - `computeMs` (number)
+ - `costUsdEstimated` (number)
- `byRuntime` (object):
  - `cloudflare`: `{ requests, tokens, computeMs, costUsdEstimated }`
  - `agentcore`: `{ requests, tokens, computeMs, costUsdEstimated }`
- `lastAggregatedAtMs` (number)
- `paid` (boolean) — may be false for current period; semantics depend on billing provider
- `invoiceId` (string, optional)
- `createdAtMs` (number)
- `updatedAtMs` (number)

Indexes:
- `by_userId_periodKey` on (`userId`, `periodKey`) (MUST)
- `by_periodKey` on `periodKey` (MAY; for ops views)

Invariants:
- One row per `(userId, periodKey)` (enforce uniqueness in code).
- Aggregation should be idempotent and can be recomputed.

Access control:
- User can read their own `billingUsage`.
- Writes are server-only (aggregation job, billing webhook handler).

---

### 3.6 `subscriptions` (optional but recommended for clarity)
Tracks subscription lifecycle independent of `users.subscriptionTier`.

Fields:
- `_id`
- `userId` (id -> `users`)
- `provider` (enum: `lemonsqueezy` | `other`)
- `providerCustomerId` (string, optional)
- `providerSubscriptionId` (string, optional)
- `status` (enum: `active | past_due | canceled | trialing | paused`)
- `tier` (enum: `free | starter | pro | enterprise`)
- `currentPeriodStartMs` (number, optional)
- `currentPeriodEndMs` (number, optional)
- `createdAtMs` (number)
- `updatedAtMs` (number)

Indexes:
- `by_userId` on `userId` (MUST)
- `by_providerSubscriptionId` on `providerSubscriptionId` (SHOULD)

Invariants:
- At most one active subscription per user in v1.

Access control:
- User can read their own subscription record.
- Writes are server-only (webhook handler).

---

### 3.7 `auditLog` (append-only)
Records privileged actions for auditability.

Fields:
- `_id`
- `userId` (id -> `users`) — owner tenant
- `actorUserId` (id -> `users`) — who performed action (same as userId in v1)
- `action` (string enum recommended):
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
- `target` (object):
  - `agentId?`, `deploymentId?`
- `metadata` (object, optional) — sanitized, no secrets
- `traceId` (string, optional)
- `createdAtMs` (number)

Indexes:
- `by_userId_createdAt` on (`userId`, `createdAtMs`) (MUST)
- `by_action_createdAt` on (`action`, `createdAtMs`) (MAY)

Access control:
- User can read their own audit log (optional UI).
- Writes are server-only.

---

## 4) Indexing guidance (Convex specifics)

Convex indexes should be selected to support the core query paths:
- list agents by user
- list deployments by agent in descending time order
- query metrics by agent and time range
- query usage by period
- find user by clerkId

Required index set (minimum):
- `users.by_clerkId`
- `agents.by_userId`
- `deployments.by_agentId_createdAt`
- `deployments.by_agentId_version`
- `metricsEvents.by_userId_timestamp`
- `metricsEvents.by_agentId_timestamp`
- `billingUsage.by_userId_periodKey`

Recommended additions:
- `agents.by_userId_name` (uniqueness and quick lookup)
- `deployments.by_userId_createdAt` (support/admin)
- `metricsEvents.by_deploymentId_timestamp` (deployment drill-down)
- `subscriptions.by_providerSubscriptionId`

---

## 5) Access control requirements (Convex functions)

### 5.1 General rule
Every query/mutation/action that reads/writes tenant-owned data MUST:
1. obtain the authenticated identity (`clerkId`),
2. resolve `userId` (create-on-first-login allowed),
3. enforce `resource.userId == currentUserId` before returning or modifying.

### 5.2 Server-only operations
The following MUST be server-only (never callable directly from untrusted clients without auth + authorization):
- deployment orchestration and provider API calls
- subscription webhook processing
- telemetry ingestion and signature verification
- cost calculation and aggregation writes
- secrets storage/injection into providers

### 5.3 Allowed client operations (MVP)
Client may call (authenticated):
- `agents.create`, `agents.update`, `agents.list`, `agents.get`, `agents.disable`, `agents.delete` (delete may be soft)
- `deployments.createAndDeploy` (but provider calls must happen in server action)
- `deployments.list`, `deployments.get`, `deployments.activate`
- `billing.createCheckout`, `billing.getUsage`
- `metrics.getSeries` (aggregated view) and optionally `metrics.listEvents` (raw, paginated) if desired

### 5.4 Preventing confused deputy
For any endpoint that accepts `{ userId, agentId, deploymentId }` in the request:
- server MUST derive `userId` from auth, not from client input
- server MUST verify `agentId` belongs to that user
- if `deploymentId` provided, verify it belongs to `agentId` and user

### 5.5 Telemetry ingestion authorization
Telemetry ingestion MUST NOT rely on user auth cookies.
Instead it MUST use:
- deployment-scoped secret signature verification, AND
- cross-check ownership against DB (agent belongs to user; deployment belongs to agent).

Rejected telemetry SHOULD be recorded to `auditLog` with sanitized metadata.

---

## 6) Deletion and retention semantics

### 6.1 Soft delete (recommended)
For `agents`:
- set `deletedAtMs` and `status=disabled`
- invocations MUST fail with `NOT_FOUND` or `UNAUTHORIZED` semantics (choose consistent behavior; prefer `NOT_FOUND` to avoid leakage)
- UI hides deleted agents by default

For related resources:
- deployments MAY be retained for audit for some time, but should be excluded from default lists if agent deleted (implementation choice).
- metricsEvents retention policy continues independently.

### 6.2 Hard delete (optional)
If implementing hard deletes:
- ensure cascading deletion is safe and does not violate audit requirements
- ensure provider resources are deprovisioned best-effort

### 6.3 Retention jobs
A scheduled server job SHOULD:
- delete `metricsEvents` older than retention for that user’s tier
- optionally compact metrics into daily/hourly aggregates (post-v1)
- keep `billingUsage` for at least 13 months (recommended) regardless of tier (or per tier)

---

## 7) Aggregation guidance (billingUsage)

### 7.1 Period standard
Choose one billing period scheme:
- Monthly calendar (recommended for v1 simplicity): `periodKey = YYYY-MM`.
- Or subscription-aligned period (more accurate but more complex).

v1 recommendation:
- Use monthly `YYYY-MM` keys.
- If subscription billing periods differ, reconcile later.

### 7.2 Aggregation strategy
A server job MUST:
- compute totals by scanning `metricsEvents` in the period window
- write/update `billingUsage` idempotently for `(userId, periodKey)`
- record `lastAggregatedAtMs`

Optimization (recommended):
- maintain incremental counters (e.g., per-day aggregates) to avoid scanning large raw tables repeatedly.

### 7.3 Idempotency
Aggregation MUST be safe to rerun:
- recompute and overwrite totals, OR
- use a checkpoint cursor and update incrementally with a stored watermark.

---

## 8) Deployment versioning strategy

### 8.1 Version assignment
`deployments.version` MUST be monotonic per agent.
Implementation options:
1. read latest version and increment (+1) within a transaction/serializable operation
2. maintain `agents.nextDeploymentVersion` counter (recommended for concurrency safety)

### 8.2 Concurrency
If two deployments start simultaneously:
- one MUST win version assignment
- the other MUST retry or fail with `CONFLICT` depending on desired UX

v1 recommendation:
- prevent concurrent deploys per agent (`agents.status=deploying` guard) to simplify.

---

## 9) Schema validation requirements

### 9.1 Enums
Store enums as strings; validate on write.

### 9.2 Limits
Enforce reasonable max sizes:
- `agents.name`: 64 chars
- `agents.description`: 2–4k chars (optional)
- `agents.envVarKeys`: max 128 keys (configurable)
- `metricsEvents`: enforce payload size limits at ingestion

### 9.3 Sanitization
`errorMessage` and `auditLog.metadata` MUST be sanitized:
- no secret values
- no raw provider credential strings
- no stack traces unless safely redacted and gated

---

## 10) Example query patterns (implementation hints)

### 10.1 Resolve user from identity
- Query `users` by `clerkId`.
- If not found, create a new user row (tier=free), then return it.

### 10.2 List agents
- index: `agents.by_userId(userId)`
- sort: by `updatedAtMs desc` or `createdAtMs desc`

### 10.3 List deployments for an agent
- index: `deployments.by_agentId_createdAt(agentId)`
- sort: descending `createdAtMs` (if supported), else fetch and reverse in code

### 10.4 Metrics time range for an agent
- index: `metricsEvents.by_agentId_timestamp(agentId)`
- query between `fromMs` and `toMs`
- bucket results into `hour` or `day` series in server function

### 10.5 Current period usage
- index: `billingUsage.by_userId_periodKey(userId, periodKey)`
- if missing or stale, trigger background aggregation job (optional) and return last known values

---

## 11) Security checklist (data model)
- [ ] No plaintext secrets stored in any table.
- [ ] `userId` denormalized on `deployments` and `metricsEvents` for fast authorization checks.
- [ ] Telemetry ingestion requires signature verification and ownership cross-check.
- [ ] Audit log captures deploy/billing/secrets actions without leaking secrets.
- [ ] Soft delete prevents data leaks and preserves auditability.

---
