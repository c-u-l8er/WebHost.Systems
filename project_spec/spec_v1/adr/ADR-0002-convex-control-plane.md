# ADR-0002: Use Convex as the Control Plane Backend (DB + Server Functions)

- **Status:** Accepted (v1)
- **Date:** 2026-01-21
- **Owners:** webhost.systems engineering
- **Related docs:** `project_spec/spec_v1/00_MASTER_SPEC.md`, `project_spec/spec_v1/10_API_CONTRACTS.md`, `project_spec/spec_v1/30_DATA_MODEL_CONVEX.md`, `project_spec/spec_v1/40_SECURITY_SECRETS_COMPLIANCE.md`

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
- a path to implement server-only operations safely (provider API calls, webhook handlers, telemetry signature verification).

---

## 2) Decision

Use **Convex** as the primary control plane backend for v1, including:

1. **Convex Database** as the system of record for:
   - `users`, `agents`, `deployments`, `metricsEvents`, `billingUsage`,
   - optional `subscriptions`, `auditLog`.

2. **Convex server functions** (queries/mutations/actions) as the primary control-plane API implementation surface for:
   - agent/deployment CRUD,
   - deployment orchestration workflows,
   - telemetry ingestion and validation,
   - billing checkout and webhook processing,
   - metrics aggregation jobs.

3. **Convex Agents** MAY be used for dashboard automation (assistant), but MUST NOT be used as the primary data plane runtime for hosting customer agents.

Convex is the control plane implementation choice. It does not change the multi-runtime architecture; runtime providers remain Cloudflare (default) and AgentCore (premium/enterprise), behind a Runtime Provider Interface (RPI).

---

## 3) Rationale

### 3.1 Engineering velocity and correctness
Convex provides a cohesive model for data + server functions that reduces glue code and accelerates iteration while retaining a strong server-side boundary for:
- entitlement checks,
- deployment state machines,
- telemetry integrity verification,
- idempotency mechanisms.

### 3.2 Real-time UX
webhost.systems benefits from “live” UI updates:
- deployment status transitions,
- near-real-time metrics rollups,
- invocation error visibility.

Convex’s reactive patterns and subscription model align well with these needs.

### 3.3 TypeScript-first developer experience
The platform is TypeScript-oriented across:
- control plane,
- UI,
- Cloudflare runtime code,
- AWS SDK usage for AgentCore.

Convex supports this well and allows the control plane to share types/contracts with the UI where appropriate.

### 3.4 Fits the separation of concerns
Convex is well suited to:
- control plane data modeling,
- authorization logic,
- scheduled aggregation jobs,
- integration glue.

It is explicitly not positioned as an ideal data plane for long-running or highly stateful untrusted customer workloads in this architecture.

---

## 4) Alternatives considered

### 4.1 Traditional backend + relational DB (e.g., Postgres + REST/GraphQL)
**Pros:**
- familiar stack,
- mature SQL querying and migrations,
- broad ecosystem.

**Cons:**
- slower initial velocity,
- more boilerplate for auth, realtime updates, and server function plumbing,
- more infrastructure to operate for an early-stage product.

### 4.2 Firebase / Supabase as backend
**Pros:**
- fast prototyping,
- auth/storage integration options.

**Cons:**
- policy/authorization models can become complex and error-prone for multi-tenant, security-sensitive workflows (telemetry, billing webhooks),
- server-side orchestration still needed for provider deploy/invoke and webhook processing,
- real-time capabilities vary by approach; may require more custom code for the required invariants.

### 4.3 “Runtime-first” approach: host control plane on a single provider (e.g., Cloudflare only)
**Pros:**
- fewer vendors,
- potentially simpler deployment story.

**Cons:**
- control plane requirements (webhooks, secure secret workflows, reliable aggregation) push toward a richer backend model,
- does not inherently provide the same DB + server-function ergonomics with strong invariants.

### 4.4 Use Convex for everything (control plane + customer agent hosting)
**Pros:**
- one platform.

**Cons (critical):**
- customer agent hosting has different constraints (untrusted code execution, long runtimes, session state, isolation requirements) that are better served by Cloudflare/AgentCore.
- control plane must remain trusted and separate from untrusted customer code execution.

---

## 5) Consequences

### 5.1 Positive consequences
- Faster implementation of the control plane.
- Clear server-only boundaries for sensitive operations.
- Easier real-time dashboards and status views.
- Strong alignment with TypeScript codebase.

### 5.2 Negative consequences / tradeoffs
- Adds a vendor dependency (Convex) in the control plane.
- Requires careful access control discipline in every query/mutation/action to prevent IDOR-style issues.
- Some long-running workflows may need design care (async deploy tasks, retry orchestration), though these are solvable within the chosen architecture.

### 5.3 Neutral consequences
- The RPI and provider adapters remain necessary regardless of control plane backend choice.

---

## 6) Implementation notes (normative requirements)

These requirements apply because we chose Convex; they are considered part of the “decision contract”.

### 6.1 Access control (MUST)
- Every Convex function that accesses tenant-owned data MUST:
  1. resolve current authenticated identity,
  2. map it to internal `users._id`,
  3. enforce `resource.userId === currentUserId` before returning or mutating any data.
- Client-supplied `userId` MUST be ignored for authorization decisions.

### 6.2 Server-only sensitive operations (MUST)
The following MUST be implemented as server-only functions and must never trust browser clients:
- runtime provider deploy operations,
- runtime provider secret injection,
- telemetry ingestion and signature verification,
- billing webhook processing and tier updates,
- usage aggregation writes.

### 6.3 Immutability and state machines (MUST)
- Deployments are immutable except status/providerRef/error fields.
- Agent `activeDeploymentId` is the only routing pointer for invocations.
- State transitions MUST match `00_MASTER_SPEC.md` and `10_API_CONTRACTS.md`.

### 6.4 Telemetry ingestion integrity (MUST)
- Telemetry events MUST be authenticated (deployment-scoped signing) and cross-checked for ownership.
- Telemetry ingestion MUST be robust to retries (dedupe recommended).

### 6.5 Secrets handling (MUST)
- No plaintext secrets stored in Convex tables.
- Convex stores only secret key names and provider secret references/metadata.
- No endpoint returns secret values.

### 6.6 Aggregation and limits (MUST)
- Limit enforcement MUST occur before provider invocation whenever possible.
- Aggregated `billingUsage` is derived from raw `metricsEvents` and must be recomputable/idempotent.

---

## 7) Security considerations specific to this decision

- Convex functions are a powerful trusted surface; mistakes in ownership checks are high severity.
- Implement defensive patterns:
  - helper to resolve `currentUserId` and enforce ownership,
  - centralized error normalization (no secrets in errors),
  - audit logging for privileged actions (deploy, secrets updates, webhook processing, telemetry rejects).
- Treat Convex as “control plane only”; never run untrusted customer agent code within Convex.

---

## 8) Migration / exit strategy (if Convex is replaced later)

If future requirements or constraints motivate replacing Convex:
- The system should remain portable because:
  - data model is documented (tables, invariants, indexes),
  - API contracts are documented (request/response/error envelopes),
  - runtime adapters are defined via RPI and independent of Convex specifics.

Migration plan (high-level):
1. Re-implement the control-plane API surface behind the same contracts.
2. Migrate data tables to the new DB preserving ids or mapping via stable external ids.
3. Maintain dual-write or read-through for a transition period if needed.
4. Cut over UI and runtime telemetry endpoints once stable.

---

## 9) Decision acceptance criteria

This ADR is considered successfully implemented when:
- Control plane features (agent CRUD, deploy orchestration, telemetry ingestion, billing webhook processing, usage aggregation) are implemented as server-side Convex functions with correct tenant isolation.
- No plaintext secrets exist in Convex storage.
- Telemetry and billing webhooks are integrity-protected and cannot be spoofed to alter usage or tier.
- The system can deploy and invoke at least one agent on Cloudflare end-to-end, and produce usage metrics in the dashboard.
- The architecture remains consistent with the multi-runtime strategy and RPI contract.