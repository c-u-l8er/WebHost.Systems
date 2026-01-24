# webhost.systems — Spec-to-Implementation Realignment Plan (v1)
Version: 1.0  
Status: Actionable checklist (spec → code)  
Audience: Engineering  
Last updated: 2026-01-24  

This document is a **realignment checklist** to ensure the WebHost.Systems implementation matches the v1 spec set under `project_spec/spec_v1/`. It is designed to be used whether you are building from scratch or bringing an existing codebase into compliance.

---

## 0) How to use this plan
1. Treat the v1 spec docs as normative:
   - `00_MASTER_SPEC.md` (goals, boundaries, flows, definitions)
   - `10_API_CONTRACTS.md` (HTTP contracts, error envelopes, auth modes)
   - `20_RUNTIME_PROVIDER_INTERFACE.md` (provider adapter contract)
   - `30_DATA_MODEL_CONVEX.md` (tables/invariants)
   - `40_SECURITY_SECRETS_COMPLIANCE.md` (security posture)
   - `50_OBSERVABILITY_BILLING_LIMITS.md` (usage, limits, retention)
   - `60_TESTING_ACCEPTANCE.md` (definition of done tests)
2. Work through sections 1–10 in order. Each item is written as a measurable “done when…”.
3. Any deviation must be captured as an ADR in `spec_v1/adr/` (don’t silently drift).

---

## 1) Baseline alignment: definitions and boundaries
### 1.1 Control plane vs data plane (hard rule)
**Spec sources:** `00_MASTER_SPEC.md`, `10_API_CONTRACTS.md`, `20_RUNTIME_PROVIDER_INTERFACE.md`

Checklist:
- [ ] Data plane executes customer agent code; control plane never does.
- [ ] Control plane stores metadata/config and orchestrates deploy/invoke/billing only.
- [ ] No control-plane endpoint directly runs untrusted bundles.

Done when:
- A code review can point to one “data plane entrypoint contract” per provider and confirm control-plane code does not execute customer code.

---

## 2) Identity model and tenancy (user-scoped v1)
**Spec sources:** `30_DATA_MODEL_CONVEX.md`, `10_API_CONTRACTS.md`

Checklist:
- [ ] One canonical mapping from auth provider identity → internal `users` row.
- [ ] Every control plane query/mutation is scoped to authenticated user.
- [ ] All “get by id” endpoints verify ownership/membership before returning data.
- [ ] Cross-tenant IDs do not leak existence (recommended: `NOT_FOUND` for foreign ids, consistently applied).

Done when:
- You have an automated “IDOR suite” that tries random IDs from other users and always gets safe failures.

---

## 3) Normalized errors: one envelope, stable codes
**Spec sources:** `10_API_CONTRACTS.md` (Normalized errors REQUIRED)

Checklist:
- [ ] All API responses use the normalized error envelope.
- [ ] Error `code` values are stable and used across the platform (no ad-hoc strings).
- [ ] Validation errors return `fields[]` with actionable field paths.
- [ ] Errors never include secret values or raw provider exceptions.

Done when:
- A single shared error helper is used everywhere, and contract tests validate the envelope shape.

---

## 4) Data model realignment (Convex schema + invariants)
**Spec sources:** `30_DATA_MODEL_CONVEX.md`

### 4.1 Tables existence
Checklist:
- [ ] `users` exists with `clerkId` (or `externalId`) unique index.
- [ ] `agents` exists and is indexed by `userId` (+ optional `userId+name` uniqueness).
- [ ] `deployments` exists with immutable history and `agentId+version` monotonic enforcement.
- [ ] `metrics` raw telemetry exists and can store per-invocation events.
- [ ] `billingUsage` aggregates exist per user+period.

### 4.2 Required invariants
Checklist:
- [ ] `agents.activeDeploymentId` always points to a deployment for that agent (or null).
- [ ] Deployments are immutable except allowed status/error/providerRef transitions.
- [ ] No plaintext secrets are stored in DB fields (see §6).
- [ ] Indices exist for:
  - agents by user
  - deployments by agent
  - metrics by agent/time and user/time
  - billingUsage by user/period

Done when:
- You can run a “schema audit script” (or manual check) verifying fields and indexes match the spec’s semantics.

---

## 5) API surface realignment (HTTP contracts)
**Spec sources:** `10_API_CONTRACTS.md`

### 5.1 Control plane endpoints
Checklist:
- [ ] Agents: create/list/get/update/disable/delete match shapes and semantics.
- [ ] Deployments: createAndDeploy, list/get, rollback match semantics.
- [ ] Secrets: write-only endpoint exists; never echoes secrets.
- [ ] Billing: checkout + webhook handler exist (server-only).

### 5.2 Invocation gateway
Checklist:
- [ ] `/v1/invoke/{agentId}` accepts `messages` or `prompt` form and returns normalized `InvokeResponse`.
- [ ] `traceId` is always generated if absent and returned consistently.
- [ ] Limits are enforced before routing to provider (hard-stop in MVP).

### 5.3 Streaming (if implemented)
Checklist:
- [ ] SSE format is consistent and versioned.
- [ ] Non-streaming remains the canonical contract; streaming is additive.

Done when:
- Contract tests run against a local server and validate request/response JSON exactly as per `10_API_CONTRACTS.md`.

---

## 6) Secrets strategy: enforce “no plaintext in DB” while remaining implementable
**Spec sources:** `00_MASTER_SPEC.md`, `10_API_CONTRACTS.md`, `20_RUNTIME_PROVIDER_INTERFACE.md`, `40_SECURITY_SECRETS_COMPLIANCE.md`

### 6.1 Customer env secrets
Checklist:
- [ ] Secrets are accepted only via the write-only endpoint.
- [ ] DB stores **key names** (`envVarKeys`) and **secret references/metadata** only.
- [ ] Provider injection sets secrets using provider-native mechanisms (Cloudflare secrets; AgentCore env injection or secret-manager refs).
- [ ] Control plane never returns secret values to clients.

### 6.2 Telemetry signing key (telemetrySecret)
Checklist:
- [ ] Each deployment has a unique telemetry signing key.
- [ ] The telemetry key is injected into the runtime as a secret.
- [ ] DB stores only a **reference/metadata** sufficient for verification.
- [ ] Control plane signature verification resolves the actual key value via:
  - provider secret store lookup, OR
  - external secret manager lookup, with server-only caching allowed.
- [ ] Rotation is supported, with an optional overlap window.

Done when:
- You can rotate secrets without data loss, and your logs show no secret material.

---

## 7) Provider adapters: RPI compliance checklist
**Spec sources:** `20_RUNTIME_PROVIDER_INTERFACE.md`, `00_MASTER_SPEC.md`

### 7.1 Adapter surface
Checklist (per provider):
- [ ] `deploy(deployInput) -> deployOutput`
- [ ] `invoke(invokeInput) -> invokeOutput` (+ optional streaming)
- [ ] `healthcheck() -> status`
- [ ] `estimateCost(usage) -> costUsd` (approx is OK for MVP)

### 7.2 Idempotency and retries
Checklist:
- [ ] Deploy is idempotent or internally deduped (safe retries).
- [ ] Invoke supports idempotency key (at least at gateway level).

### 7.3 Cloudflare adapter
Checklist:
- [ ] Deployment produces worker bundle + DO bindings when sessionful.
- [ ] Invocation routes to worker/DO appropriately.
- [ ] Telemetry is emitted with deployment-scoped signature.

### 7.4 AgentCore adapter
Checklist:
- [ ] Treat deployment as artifact-based (container-first).
- [ ] SDK/package variability is isolated behind adapter boundaries.
- [ ] Tier gating prevents unsupported users from deploying/invoking AgentCore.

Done when:
- A “provider conformance test” suite can run deploy→invoke→telemetry roundtrip per provider.

---

## 8) Limits, billing, and enforcement (v1)
**Spec sources:** `00_MASTER_SPEC.md`, `50_OBSERVABILITY_BILLING_LIMITS.md`, `10_API_CONTRACTS.md`

Checklist:
- [ ] Limit types exist: requests/tokens/computeMs + runtime gating.
- [ ] Enforcement points exist:
  - invocation gateway hard-stops when exceeded
  - deploy blocks gated runtimes
- [ ] Aggregation job produces `billingUsage` per period.
- [ ] Retention defaults are defined and enforced or explicitly marked as “deferred but specified”.

Done when:
- A user can exceed limits and always gets `LIMIT_EXCEEDED` deterministically (no partial charges beyond policy).

---

## 9) Observability: traceability and safe logging
**Spec sources:** `00_MASTER_SPEC.md`, `14 Observability` section, `50_OBSERVABILITY_BILLING_LIMITS.md`

Checklist:
- [ ] Every invocation has a `traceId`.
- [ ] Telemetry events include `traceId`, `userId`, `agentId`, `deploymentId` attribution.
- [ ] Logs never contain secret values (headers, env vars, tokens, signing keys).
- [ ] Minimal UI/backend query support exists for:
  - “recent invocation errors”
  - deployments status
  - usage for billing period

Done when:
- You can answer: “why did invocation X fail?” using traceId across gateway + provider telemetry without exposing secrets.

---

## 10) Testing and acceptance (definition of done)
**Spec sources:** `60_TESTING_ACCEPTANCE.md` (plus API/data model invariants)

Minimum required tests:
- [ ] IDOR / tenancy isolation tests for all “get by id” endpoints.
- [ ] Contract tests for normalized error envelopes.
- [ ] Deploy pipeline golden path:
  - upload bundle → deploy → set active → rollback
- [ ] Invoke golden path:
  - invoke → response → telemetry event accepted and attributed
- [ ] Limits tests:
  - exceed requests/tokens/computeMs and verify hard-stop behavior
- [ ] Secrets tests:
  - ensure no plaintext secrets in DB fields and logs
  - telemetry signature verification works

Done when:
- You can demonstrate the v1 acceptance criteria from `00_MASTER_SPEC.md` end-to-end on Cloudflare, and (if enabled) on AgentCore for a paid tier.

---

## Appendix A) Known spec-sensitive integration points (watch these)
1. **Telemetry secret verification**: must be implementable without storing plaintext secrets in DB.
2. **Delegated invocation**: must bill/enforce as the delegated user, never as the caller service.
3. **Deployment immutability**: avoid “editing deployments in place”; use status transitions and active pointer.
4. **Error normalization**: keep provider errors internal; map to stable codes.

---

## Appendix B) If the codebase already exists: recommended realignment sequence
1. Lock down identity + tenancy checks (stop data leaks first).
2. Normalize errors across endpoints.
3. Enforce secrets handling and redact logs.
4. Make deployments immutable + active pointer.
5. Ensure telemetry is authenticated and attributable.
6. Add billing usage aggregation + limit enforcement.
7. Finish provider conformance tests and acceptance suite.