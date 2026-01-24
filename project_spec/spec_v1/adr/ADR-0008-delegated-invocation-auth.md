# ADR-0008: Delegated Invocation Auth Mode (Server-to-Server HMAC)
- **Status:** Accepted
- **Date:** 2026-01-24
- **Owners:** Engineering
- **Applies to:** `webhost.systems` control plane
- **Decision Scope:** Add a service-authenticated “delegated invocation” mode so trusted backend systems (e.g., workflow orchestrators) can invoke WHS agents on behalf of an end user without forwarding browser tokens.
- **Related Specs:**
  - `project_spec/spec_v1/00_MASTER_SPEC.md` (control plane vs data plane boundary; invocation semantics)
  - `project_spec/spec_v1/10_API_CONTRACTS.md` (invocation gateway; normalized errors; telemetry auth model)
  - `project_spec/spec_v1/20_RUNTIME_PROVIDER_INTERFACE.md` (invoke contract)
  - `project_spec/spec_v1/30_DATA_MODEL_CONVEX.md` (tenant isolation; access control)
  - `project_spec/spec_v1/40_SECURITY_SECRETS_COMPLIANCE.md` (threat model; secrets; abuse controls)
  - `project_spec/spec_v1/adr/ADR-0004-telemetry-integrity.md` (HMAC over raw bytes precedent)
  - External integration: `ProjectWHS/agentromatic.com/project_spec/whs_integration.md` (consumer contract)

---

## 1) Context

The canonical WHS invocation endpoint (`POST /v1/invoke/:agentId`) is authenticated using the product’s normal control-plane auth mechanism (e.g., Clerk JWT). This works for browser clients and first-party UIs.

However, some portfolio systems execute server-side and need to invoke WHS agents as part of durable orchestration. Example:
- Agentromatic executes workflow runs in its backend (Convex action), and wants to run an “agent step” by invoking a WHS agent.

Constraints:
- Server-side orchestrators should **not** rely on browser tokens.
- Forwarding end-user JWTs through backend systems increases leakage risk and couples execution to user session semantics.
- WHS must remain authoritative for:
  - agent ownership/visibility,
  - plan entitlements and limit enforcement,
  - telemetry, usage, billing.
- Multi-tenant safety MUST be preserved: delegated invocations must not allow cross-tenant invocation.

We already have a proven pattern for signed service-originated traffic:
- Telemetry ingestion is protected using deployment-scoped HMAC verification over raw bytes.

We need an analogous but distinct mechanism for **delegated invocation**.

---

## 2) Decision

### 2.1 Introduce a delegated invocation auth mode using HMAC over raw bytes (v1)
WHS will support an additional invocation auth mode for trusted backend callers (“delegators”):

- The delegator sends a request with:
  - an HMAC signature computed over the **raw request body bytes**.
  - a timestamp used for replay protection.
  - a declared delegated end-user identity (`externalUserId`) in the JSON body.
  - an idempotency key to prevent duplicate cost/side effects across retries.

This is **service authentication** for the delegator, not user authentication. WHS must still enforce user-scoped authorization using the delegated user identity.

### 2.2 Dedicated endpoint is preferred
To avoid ambiguity and reduce accidental exposure, WHS SHOULD expose a dedicated endpoint:

- `POST /v1/delegated/invoke/:agentId`

This endpoint is intended for server-to-server traffic and MUST NOT accept browser JWT auth as a substitute for the delegated signature scheme. (If a combined endpoint is introduced later, it must be explicitly designed and re-reviewed.)

### 2.3 Delegated invocation does not bypass WHS authorization
For delegated invocations:
- WHS resolves `externalUserId` to a WHS `users` row.
- WHS enforces all standard checks **as that user**, including:
  - agent ownership/visibility (no cross-tenant access),
  - agent status (not disabled),
  - active deployment present,
  - plan entitlements and limits,
  - runtime provider gating (e.g., AgentCore tier gating),
  - request-limit enforcement (pre-invoke),
  - any additional internal safety controls.

The delegator’s HMAC signature proves only that the request came from an approved delegator. It does not grant permission to invoke arbitrary agents as arbitrary users.

---

## 3) Normative request authentication

### 3.1 Required headers
Delegated requests MUST include:

- `X-WHS-Delegation-Source: <string>`
- `X-WHS-Delegation-Timestamp: <epoch_ms_as_string>`
- `X-WHS-Delegation-Signature: v1=<hex(hmac_sha256(raw_body_bytes, WHS_DELEGATION_SECRET))>`

Rules:
- Signature MUST be computed over the exact raw bytes received (no re-serialization differences).
- Signature verification MUST occur before parsing the JSON body (except to read raw bytes).
- Timestamp MUST be validated against an allowed skew window.

Recommended default skew window:
- `abs(nowMs - timestampMs) <= 300000` (5 minutes)

If signature or timestamp validation fails:
- return a normalized error:
  - `code: UNAUTHENTICATED`
  - safe `message`
  - `retryable: false` (recommended)

### 3.2 Delegation source allowlist (recommended)
WHS SHOULD maintain a small allowlist of approved delegation sources:
- e.g., `agentromatic`, `agentelic` (future), `internal`

Requests with an unknown `X-WHS-Delegation-Source` SHOULD be rejected with `UNAUTHENTICATED`.

This reduces blast radius if the shared secret leaks to an unintended system.

### 3.3 Body requirements (delegation envelope)
The request body MUST include a delegation envelope:

- `delegation.mode = "hmac_v1"`
- `delegation.externalUserId: string` (stable external auth subject id)
- `delegation.idempotencyKey: string` (see §5)
- optional correlation metadata for observability:
  - workflow ids, execution ids, node ids, etc.

The request body MUST include the normal invocation request shape under `invoke` (compatible with `InvokeRequest`).

The body MUST NOT include:
- plaintext secret values (keys, tokens, credentials)
- raw end-user auth tokens

---

## 4) Error semantics

Delegated invoke MUST use the same normalized error envelope as the WHS API contracts, with stable codes, safe messages, and no secrets.

Minimum codes relevant to delegated invocation:
- `UNAUTHENTICATED` (bad signature, unknown source, timestamp invalid)
- `UNAUTHORIZED` (delegated user not allowed to invoke agent)
- `NOT_FOUND` (agent not found or not visible to delegated user)
- `LIMIT_EXCEEDED` (plan limits)
- `INVALID_REQUEST` (bad schema, oversized payload)
- `RUNTIME_ERROR` (provider/runtime failures)
- `INTERNAL_ERROR`

Consistency rule:
- Tenant isolation MUST not leak resource existence. If the delegated user cannot see the agent, prefer `NOT_FOUND` over `UNAUTHORIZED` (align with the system’s broader IDOR strategy).

---

## 5) Idempotency requirements (MUST)

Delegated invocations are commonly retried by orchestrators and can be executed under “at least once” semantics. Therefore:

### 5.1 Client-provided idempotency key is required
Delegated invocation requests MUST include `delegation.idempotencyKey`.

The key MUST be:
- stable across retries of the same logical invocation,
- scoped to the logical operation (e.g., workflow execution step),
- secret-free,
- bounded in length (recommended <= 200 chars).

### 5.2 WHS idempotency behavior is required
WHS MUST dedupe delegated invocations at minimum by:
- `(externalUserId, agentId, delegation.idempotencyKey)`

Behavior:
- If a request is received again with the same tuple, WHS MUST return:
  - the same logical response (or a stable reference), and MUST NOT double-charge or double-run side effects.
- If the same idempotency key is reused with a different payload (material difference), WHS MUST return:
  - `CONFLICT` or `INVALID_REQUEST` (choose one; keep consistent),
  - safe message: “Idempotency key reused with different payload.”

Implementation guidance (non-normative):
- Store an idempotency ledger row containing:
  - request hash (e.g., sha256 of raw bytes),
  - response payload or response reference (bounded),
  - traceId/sessionId,
  - timestamps and status.

---

## 6) Security analysis (threats and mitigations)

### 6.1 Threat: delegator attempts to invoke as another user
Mitigation:
- WHS enforces authorization based on `externalUserId` resolved user row.
- WHS enforces ownership/visibility checks and entitlements.
- Delegation does not grant cross-tenant access.

### 6.2 Threat: replay attacks
Mitigation:
- Timestamp window validation (required).
- Idempotency key dedupe (required).
- Optional: store `(source, idempotencyKey, timestamp)` replay ledger (recommended if attack surface warrants).

### 6.3 Threat: secret leakage (logs, errors)
Mitigation:
- Never log signature headers or secret material.
- Normalize errors with safe messages.
- Bound and redact any stored snippets (if any).
- Do not persist raw request bodies unbounded.

### 6.4 Threat: abuse / DoS via delegated endpoint
Mitigation:
- Apply rate limiting per delegated user and per source.
- Apply plan limits before invoking runtime providers.
- Enforce payload size limits.
- Consider additional internal caps per `X-WHS-Delegation-Source`.

---

## 7) Consequences

### Positive
- Enables durable server-side orchestration systems to invoke WHS safely without browser token forwarding.
- Keeps WHS authoritative for cost/limits and tenant isolation.
- Reuses the proven HMAC-over-raw-bytes integrity pattern.
- Provides clean correlation between workflows (or other orchestrators) and WHS telemetry via metadata.

### Tradeoffs
- Requires managing a shared secret and secure deployment across systems.
- Introduces a new internal endpoint surface that must be rate-limited and monitored.
- Requires idempotency ledger storage and conflict handling.

---

## 8) Implementation checklist (v1)

WHS control plane MUST implement:
1. `POST /v1/delegated/invoke/:agentId`
2. Raw-bytes HMAC verification:
   - signature header parsing
   - timestamp window checks
   - source allowlist (recommended)
3. Delegated user resolution:
   - `externalUserId` → WHS `users` row
4. Standard invocation pipeline:
   - entitlements + limits check (pre-invoke)
   - resolve active deployment
   - route to provider adapter
   - normalize errors
5. Idempotency ledger:
   - dedupe by `(externalUserId, agentId, idempotencyKey)`
   - conflict detection for key reuse with different payload
6. Observability:
   - include delegation source + correlation metadata in logs/metrics (secret-free)
   - ensure no secrets in logs

---

## 9) Acceptance criteria
- A trusted server-side caller can invoke a WHS agent via delegated endpoint and receive a standard `InvokeResponse`.
- Invalid signatures and stale timestamps are rejected with `UNAUTHENTICATED`.
- Delegated invocations cannot invoke another user’s agent (tenant isolation enforced).
- Plan limits are enforced for delegated users (`LIMIT_EXCEEDED`).
- Replays and retries do not cause duplicate invocations due to idempotency.
- No secret material is present in logs, error envelopes, or stored artifacts.

---