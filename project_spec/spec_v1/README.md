# webhost.systems — Spec v1 (Implementation-Ready Document Set)
Version: 1.0  
Status: Implementation-ready draft  
Audience: Engineering  
Last updated: 2026-01-21

This folder is the **canonical v1 specification** for implementing webhost.systems from scratch. It consolidates product + technical requirements into a small set of normative documents with ADRs (Architecture Decision Records). If you implement only what’s in these files, you should be able to build a working v1.

## How to use this spec (recommended reading order)

1. **Start here (overall system)**
   - `00_MASTER_SPEC.md` — the single “master” engineering spec: scope, architecture, flows, core requirements, acceptance criteria.

2. **Implement your API surface and contracts**
   - `10_API_CONTRACTS.md` — normalized request/response shapes, error envelope, idempotency, pagination, invocation gateway, telemetry ingestion, and billing/webhook contracts.

3. **Implement runtime portability**
   - `20_RUNTIME_PROVIDER_INTERFACE.md` — Runtime Provider Interface (RPI) that all runtimes must implement, plus adapter guidance.

4. **Build your control-plane data layer**
   - `30_DATA_MODEL_CONVEX.md` — Convex schema, indexes, invariants, access control rules, retention and deletion semantics.

5. **Lock down security and secrets**
   - `40_SECURITY_SECRETS_COMPLIANCE.md` — threat model, secrets strategy requirements, telemetry integrity, webhook integrity, artifact safety, acceptance criteria.

6. **Build metering, billing UX, and enforcement**
   - `50_OBSERVABILITY_BILLING_LIMITS.md` — telemetry pipeline, aggregation model, cost estimation (estimated in v1), tier entitlements, runtime gating, limit enforcement algorithms.

7. **Verify correctness end-to-end**
   - `60_TESTING_ACCEPTANCE.md` — unit/integration/E2E test plan + release gates and system-level definition of done.

## Architecture Decision Records (ADRs)

ADRs document the “why” behind major choices and define additional constraints that implementations must satisfy.

- `adr/ADR-0001-multi-runtime.md` — Multi-runtime strategy (Cloudflare default + AgentCore premium).
- `adr/ADR-0002-convex-control-plane.md` — Convex as control-plane backend; Convex Agents for dashboard automation only.
- `adr/ADR-0003-secrets-strategy.md` — No plaintext secrets in DB; provider-native secret injection; write-only secrets API.
- `adr/ADR-0004-telemetry-integrity.md` — Deployment-scoped signed telemetry events + ownership cross-check.
- `adr/ADR-0005-deployment-immutability.md` — Immutable deployment records + `activeDeploymentId` routing pointer + rollback.
- `adr/ADR-0006-invocation-protocol.md` — Canonical `invoke/v1` protocol, session semantics, and SSE streaming model.
- `adr/ADR-0007-entitlements-and-limits.md` — Tier entitlements, runtime gating, and limit enforcement strategy.

## Normative conventions used in this spec

- **MUST / MUST NOT / SHOULD / MAY** are used intentionally.
- **Control plane** = auth, DB, deploy orchestration, billing, telemetry ingestion/aggregation, UI API.
- **Data plane** = runtime provider execution environments (Cloudflare Workers/DO, AWS AgentCore).
- **Session IDs** are **opaque** and runtime-specific; the control plane and clients must not parse them.
- **Deployments** are **immutable** records; routing is via the agent’s single `activeDeploymentId`.

## Implementation “starter checklist” (quick reference)

Minimum v1 must-haves:
- Auth + tenant isolation across all endpoints.
- Agent CRUD.
- Immutable deployments + rollback (active pointer).
- Invocation gateway with consistent `invoke/v1` contract (non-streaming required; streaming recommended).
- Telemetry ingestion with integrity protection (deployment-scoped signing) and ownership cross-check.
- Usage aggregation by billing period + dashboard usage views.
- Tier entitlements + runtime gating (AgentCore gated) + at least request-limit enforcement.
- No plaintext secrets in the primary DB; secrets injected into providers.
- Retention for raw telemetry/logs by tier (at minimum: raw telemetry deletion job).
- E2E flow: create agent → set secrets → deploy (Cloudflare) → invoke → view usage.

## Out of scope (explicit v1 non-goals)

- Team/org/role-based access control (single-owner resources only).
- Perfect cost reconciliation with provider billing exports (v1 cost is “estimated”).
- Public agents / unauthenticated invocation (unless explicitly added later with API keys).
- Full prompt/response storage (telemetry is numeric and metadata-focused by default).

## Notes on older drafts

This folder is intended to supersede earlier rough drafts in `project_spec/`. The older drafts are useful as background, but **implementation should follow `spec_v1/`**.

If any contradictions are found:
1. Prefer `00_MASTER_SPEC.md` and `10_API_CONTRACTS.md` for canonical behavior.
2. Prefer ADRs for “why” and invariants.
3. Treat earlier drafts as non-normative.
