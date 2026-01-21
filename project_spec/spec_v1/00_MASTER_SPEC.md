# webhost.systems — MASTER ENGINEERING SPEC (v1)
Version: 1.0  
Status: Implementation-ready draft  
Audience: Engineering (primary), Product/Security (secondary)  
Last updated: 2026-01-21  

> Goal: This document is intended to be sufficient context for an engineer (or coding agent) to implement webhost.systems from scratch without needing additional specs.

---

## 0) Executive summary

webhost.systems is a multi-runtime AI agent deployment and hosting platform. It provides:

- a **control plane** (UI + APIs) for creating agents, deploying code, managing configuration/secrets, viewing logs/metrics, and billing;
- a **data plane** for executing agents on one of multiple runtime providers:
  - **Cloudflare Workers + Durable Objects** (default; global edge, strong economics),
  - **AWS Bedrock AgentCore** (premium/enterprise; long-running sessions, enterprise isolation and built-in tools ecosystem).

A third system, **Convex (DB + server functions + optional “Convex Agents”)**, is used for control plane logic and dashboard automation—not primary agent hosting.

Core differentiator: **runtime portability under a single abstraction**, plus **first-class metering and limit enforcement**.

---

## 1) Scope, goals, non-goals

### 1.1 Goals (MVP → v1)
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
   - optional streaming (SHOULD for Cloudflare; MAY for AgentCore depending on SDK support).
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
- Perfect cost accuracy at MVP (cost can be “estimated” until reconciled with provider billing exports).
- Team/org/roles/SCIM in MVP (can be post-MVP unless required).

### 1.3 Assumptions
- Control plane uses **Convex** as primary database and backend functions (or an equivalent serverless backend; if substituted, preserve schema + invariants).
- Auth uses **Clerk** (or equivalent); spec assumes external IdP.
- Billing uses **LemonSqueezy** (or equivalent); spec assumes webhook-driven entitlement.
- Runtime providers initially: Cloudflare Workers/DO and AWS AgentCore.

---

## 2) Key decisions (ADR-style summaries)

### ADR-0001: Multi-runtime architecture
**Decision:** Support multiple runtime providers behind a single abstraction.  
**Rationale:** Avoid lock-in, optimize for cost/global edge for most users, offer enterprise-grade long-running isolation for premium customers.  
**Consequences:** Requires a Runtime Provider Interface (RPI), consistent telemetry schema, and deployment packaging that can target multiple runtimes.

### ADR-0002: Convex for control plane
**Decision:** Use Convex for data + backend functions; optional Convex Agents for dashboard automation.  
**Rationale:** Rapid development, strongly typed backend, good fit for control plane.  
**Constraint:** Convex Agents are not used for primary agent hosting due to runtime/time limits and differing execution model.

### ADR-0003: Secrets strategy
**Decision:** Do not store plaintext secrets in Convex. Store only **secret metadata** (keys/names) and push secret values to provider secret mechanisms.  
**Rationale:** Reduce breach impact and align with best practices.

### ADR-0004: Usage and cost
**Decision:** Capture near-real-time usage events; compute **estimated cost** via provider-specific calculators at MVP; add reconciliation later.  
**Rationale:** Enables limits, billing UX, and pricing iteration early.

### ADR-0005: Deployment immutability + active pointer
**Decision:** Deployments are immutable records; an agent has an `activeDeploymentId` pointer.  
**Rationale:** Rollbacks, audits, reproducibility, and safer operations.

---

## 3) Glossary (canonical terms)

- **User**: authenticated account holder.
- **Agent**: a logical AI service owned by a user; has a selected runtime provider and configuration.
- **Deployment**: immutable version of an agent published to a runtime provider.
- **Runtime Provider**: execution environment; initially `cloudflare` and `agentcore`.
- **Invocation**: a request to execute an agent (stateless or sessionful).
- **Session**: provider-specific stateful context; represented as opaque `sessionId`.
- **Control Plane**: dashboard + APIs + DB + billing + deployment orchestration.
- **Data Plane**: runtime execution environments.
- **Telemetry Event**: per-invocation metrics emitted from data plane to control plane.

---

## 4) System architecture

### 4.1 High-level components
1. **Web UI** (recommended: Next.js/React; can be substituted)
   - Agents list/detail
   - Deploy flow
   - Logs/metrics view
   - Billing/plan view
2. **Auth provider** (recommended: Clerk)
3. **Control plane backend** (Convex functions/actions)
   - agent CRUD
   - deployment orchestration
   - billing entitlement + enforcement
   - telemetry ingestion + aggregation
   - dashboard assistant (optional)
4. **Runtime providers**
   - Cloudflare Workers + Durable Objects
   - AWS Bedrock AgentCore (TypeScript SDK support)
5. **Billing provider**
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
  - never has broad access to other tenants’ data

### 4.3 Request flows (canonical)

#### Flow A — Create agent
1. UI calls control plane: `agents.create`
2. Control plane creates `agents` row (status: `created`)
3. UI shows agent detail page

#### Flow B — Deploy agent
1. UI uploads bundle OR provides repo reference (MVP can start with uploaded bundle)
2. UI calls control plane: `deployments.createAndDeploy`
3. Control plane:
   - validates inputs (size, required files, allowed runtime)
   - creates immutable `deployments` row (status: `deploying`)
   - invokes runtime provider adapter to deploy
   - updates deployment status; sets `agents.activeDeploymentId` on success

#### Flow C — Invoke agent
1. Client calls `POST /invoke/:agentId` (edge gateway) OR calls a generated SDK endpoint.
2. Control plane:
   - authenticates/authorizes
   - checks plan limits and agent status
   - routes to runtime provider invocation endpoint
3. Data plane runs agent, returns response (optionally streaming)
4. Data plane emits telemetry event to control plane ingestion endpoint

#### Flow D — Usage aggregation / billing
1. Telemetry events stored in `metrics` table (raw)
2. Scheduled job aggregates into `billingUsage` by user + period
3. UI reads `billingUsage` and shows limits/overages

---

## 5) Product requirements (engineering-focused)

### 5.1 Agent management
MUST:
- Create agent with:
  - `name` (unique per user, or unique within user namespace),
  - `description` (optional),
  - `framework` (enum/string; informational at MVP),
  - `runtimeProvider` (`cloudflare` | `agentcore`),
  - `envVarKeys` (list of keys; values handled separately),
  - `status` (`created` | `deploying` | `active` | `error` | `disabled`).
- Edit agent metadata (name/description/framework/default runtime settings).
- Disable an agent (invocations rejected).

SHOULD:
- “Clone agent” (copy config + latest deployment reference).

### 5.2 Deployments
MUST:
- Keep immutable deployment history.
- Store deployment inputs:
  - `version` (semver or monotonic int),
  - `commitHash` (optional),
  - `runtimeProvider`,
  - provider-specific reference fields,
  - timestamps, status transitions, and error messages.
- Support rollback by switching `activeDeploymentId`.

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
  - update `users.subscriptionTier` and entitlements

---

## 6) Data model (Convex) — required schema + invariants

> The schema below is normative. Field names can vary, but semantics and invariants must be preserved.

### 6.1 `users`
Fields:
- `_id`
- `clerkId` (unique)
- `email`
- `name`
- `subscriptionTier` (`free` | `starter` | `pro` | `enterprise`)
- `defaultRuntimeProvider` (`cloudflare` | `agentcore`)
- `createdAt`

Indexes:
- by `clerkId`
- by `email` (optional)

Invariants:
- One user row per clerk identity.

### 6.2 `agents`
Fields:
- `_id`
- `userId`
- `name`
- `description?`
- `framework` (string)
- `runtimeProvider` (`cloudflare` | `agentcore`)
- `activeDeploymentId?`
- `status` (`created` | `deploying` | `active` | `error` | `disabled`)
- `envVarKeys` (string[])
- `providerConfig`:
  - for cloudflare: `{ workerName?, workerUrl?, durableObjectNamespace?, durableObjectId? }`
  - for agentcore: `{ agentRuntimeArn?, runtimeId?, region?, vCpu?, memoryMb? }`
- `createdAt`
- `lastDeployedAt?`

Indexes:
- by `userId`
- by `userId + name` (for uniqueness checks)
- by `activeDeploymentId` (optional)

Invariants:
- `userId` must exist.
- `activeDeploymentId` (if present) must reference a deployment for this agent.

### 6.3 `deployments`
Fields:
- `_id`
- `agentId`
- `version` (monotonic per agent)
- `runtimeProvider`
- `status` (`deploying` | `active` | `failed` | `rolled_back`)
- `commitHash?`
- `artifact`:
  - `type`: `uploaded_bundle` | `repo_ref`
  - `sourceUri` or storage reference
  - `checksum`
- `providerRef`:
  - cloudflare: `{ workerUrl, durableObjectId? }`
  - agentcore: `{ agentRuntimeArn, runtimeSessionConfig? }`
- `errorMessage?`
- `logsRef?`
- `deployedAt`
- `deployedBy` (userId)

Indexes:
- by `agentId + deployedAt desc`
- by `agentId + version`

Invariants:
- Deployment records are immutable after creation except status/error fields and providerRef.

### 6.4 `metrics` (raw telemetry events)
Fields:
- `_id`
- `userId`
- `agentId`
- `deploymentId?`
- `runtimeProvider`
- `timestamp`
- `requests` (int; usually 1)
- `llmTokens` (int; estimated or reported)
- `computeMs` (int)
- `errors` (int)
- `errorClass?` (`auth` | `limit` | `runtime` | `tool` | `unknown`)
- provider-specific:
  - cloudflare: `{ durableObjectOps?, workersAICalls? }`
  - agentcore: `{ sessionDurationMs?, toolInvocations?, browserInteractions? }`
- `costUsd` (number; estimated at MVP)
- `traceId?`

Indexes:
- by `agentId + timestamp`
- by `userId + timestamp`
- by `deploymentId + timestamp` (optional)

### 6.5 `billingUsage` (aggregated)
Fields:
- `_id`
- `userId`
- `period` (e.g., `2026-01` or ISO range key)
- totals:
  - `totalRequests`
  - `totalTokens`
  - `totalComputeMs`
  - `totalCostUsd`
- per-runtime breakdown:
  - `cloudflare: { requests, tokens, costUsd }`
  - `agentcore: { requests, tokens, costUsd }`
- `paid` (boolean)
- `invoiceId?`
- `updatedAt`

Indexes:
- by `userId + period`

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

> Exact routing depends on chosen framework. If using Convex, implement as queries/mutations/actions with consistent naming.

### 11.1 Auth
- `auth.getCurrentUser()` -> user profile + tier

### 11.2 Agents
- `agents.create({ name, description?, framework, runtimeProvider, envVarKeys })`
- `agents.update({ agentId, ...fields })`
- `agents.list()`
- `agents.get({ agentId })`
- `agents.disable({ agentId })`
- `agents.delete({ agentId })` (should also revoke provider resources if possible)

### 11.3 Deployments
- `deployments.createAndDeploy({ agentId, artifactRef, commitHash?, version? })`
- `deployments.list({ agentId })`
- `deployments.rollback({ agentId, deploymentId })`
- `deployments.getLogs({ deploymentId })` (can be stubbed in MVP)

### 11.4 Invocation gateway
- `invoke({ agentId, input, sessionId?, options?, metadata? })` (server endpoint)
- MUST:
  - authorize user (or allow public agents if you later add that feature)
  - check entitlements and limits
  - route to active deployment’s runtime provider adapter

### 11.5 Telemetry ingestion
- `metrics.report(event)` (authenticated with shared secret or signed token from runtime)
- MUST validate:
  - event attribution
  - prevent spoofing (HMAC signature or runtime-specific auth)

### 11.6 Billing
- `billing.createCheckout({ tier })`
- `billing.handleWebhook(payload)` (server-only)
- `billing.getUsage({ period? })`

---

## 12) Plan limits and enforcement (normative)

### 12.1 Limit types
- requests per billing period
- tokens per billing period
- compute ms per billing period
- runtime access (AgentCore gated)

### 12.2 Enforcement points
- At invocation time in control plane:
  - read `billingUsage` current period (or a fast cached counter)
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
- Every control plane query/mutation checks `userId`.
- Runtime provider resources are namespaced per user (naming convention + tags).

### 13.2 Secrets handling
MUST:
- Never log secret values.
- Never store plaintext secrets in Convex tables.
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

### 15.1 Artifact types
- `uploaded_bundle`: zip/tar containing:
  - `agent.config.json` (required)
  - entrypoint file (required)
- `repo_ref`: `{ githubUrl, ref }` (post-MVP if CI needed)

### 15.2 Required manifest (`agent.config.json`)
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

### 15.3 Validation rules
MUST:
- enforce max artifact size
- enforce required files present
- enforce runtime compatibility

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
- only access the authenticated user’s resources
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
- create agent → deploy → invoke → view metrics → upgrade tier

---

## 18) Milestones (implementation plan)

### Phase 1 — Control plane foundation
- Auth integration
- Convex schema + CRUD
- Basic dashboard UI
- Billing tier model stub (no payment yet)

### Phase 2 — Cloudflare runtime
- Cloudflare deploy adapter
- Invocation gateway routing to Cloudflare
- Telemetry ingestion from DO/Worker
- Usage UI

### Phase 3 — Billing + enforcement
- Checkout + webhooks
- Limit enforcement on invoke and deploy
- Retention policies (basic)

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
- A user can sign up, create an agent, deploy to Cloudflare, invoke it, and see metrics in the dashboard.
- A paid tier user can deploy to AgentCore (if enabled) and invoke successfully.
- Limits are enforced reliably and errors are normalized.
- No plaintext secrets are stored in the primary database.
- Deployments are immutable and rollback works.
- Telemetry events are authenticated and attributable to user/agent/deployment.