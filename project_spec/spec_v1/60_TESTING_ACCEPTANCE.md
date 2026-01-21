# webhost.systems — Testing Plan & Acceptance Criteria (v1)
Version: 1.0  
Status: Implementation-ready  
Last updated: 2026-01-21  
Audience: Engineering (primary)

This document defines an end-to-end testing plan and concrete acceptance criteria for implementing webhost.systems from scratch with confidence. It covers unit, integration, and E2E tests across the control plane (auth, CRUD, deploy, billing, limits), data plane (Cloudflare + AgentCore), and integrity-sensitive ingress points (telemetry, billing webhooks).

Normative language: MUST, MUST NOT, SHOULD, MAY.

---

## 1) Testing philosophy

### 1.1 What we optimize for
- **Confidence over coverage**: prioritize tests that prevent high-severity regressions (tenant isolation, billing integrity, secrets leakage, limit enforcement, deploy/invoke correctness).
- **Defense-in-depth**: validate the same invariant at multiple layers where it matters:
  - auth + ownership checks in every endpoint,
  - runtime adapter checks (entitlement and state),
  - telemetry signature verification,
  - billing webhook signature verification.

### 1.2 What “done” means
A feature is considered complete when:
- acceptance criteria in this document are met,
- critical paths have automated tests at the appropriate level (unit/integration/E2E),
- failure modes are tested (bad input, provider failure, retry/idempotency, unauthorized access),
- logs and errors are sanitized (no secrets).

### 1.3 Test pyramid
- **Unit tests (fast, many)**: pure functions, validators, mappers, cost models, limit checks, signature verification.
- **Integration tests (medium)**: control plane functions with real DB (or local emulator), provider adapters against mocked HTTP and/or sandbox accounts, webhook verification.
- **E2E tests (slow, few)**: full user flows through UI/API with a real auth session and at least one real runtime environment.

---

## 2) Environments & prerequisites

### 2.1 Environments
MUST maintain at least:
- **dev**: local development (may use provider mocks)
- **staging**: end-to-end test environment with sandbox provider credentials
- **prod**: production

SHOULD:
- Separate credentials per environment (Cloudflare token, AWS credentials, billing webhook secret).
- Separate billing provider “store/project” per environment to avoid accidental production entitlements.

### 2.2 Test accounts
MUST provision sandbox accounts for:
- Cloudflare (Workers + Durable Objects)
- AWS (AgentCore; plus any required secret mechanism)
- Billing provider (webhook signature testing)

### 2.3 Deterministic test agent artifact
Maintain a minimal “fixture agent” artifact that:
- supports `invoke/v1` protocol
- returns deterministic output
- can optionally create a session and echo the session id
- emits a telemetry event (if Pattern A is used)
- can be deployed to both providers with minimal changes
- includes an AgentCore-targeted variant (or feature flag) suitable for validating **TypeScript deployment** and **tool-enabled invocation** scenarios:
  - Code Interpreter tool invocation path (expected to perform a deterministic computation)
  - Browser tool invocation path (expected to fetch a deterministic target like `example.com` and return a stable string such as the page title)
  - clear, test-detectable markers in output indicating tool usage occurred (e.g., “tool_used:code_interpreter”)

The fixture agent MUST NOT include any real secrets; use ephemeral test secrets.

---

## 3) Unit test plan (required)

### 3.1 Validators and schema enforcement
MUST unit test:
- Agent create/update validation:
  - name constraints
  - runtimeProvider enum validation
  - envVarKeys rules
- Manifest parsing and validation:
  - required fields present
  - protocol supported (`invoke/v1`)
  - runtime matches selected runtimeProvider
  - entrypoint present
- Payload limits:
  - max request size
  - max messages
  - max message length

Acceptance:
- Invalid inputs consistently return `INVALID_REQUEST` with field-level issues (or equivalent structured detail).

### 3.2 Normalized error mapping
MUST unit test provider error mapping tables:
- Cloudflare deploy errors -> `DEPLOYMENT_FAILED`
- Cloudflare invoke errors -> `RUNTIME_ERROR`
- AgentCore deploy errors -> `DEPLOYMENT_FAILED`
- AgentCore invoke errors -> `RUNTIME_ERROR`

Test cases MUST cover:
- auth/credential failures (retryable=false)
- transient provider failures (retryable=true)
- invalid config/manifest (retryable=false)

Acceptance:
- No raw provider errors are passed through to clients.
- Error envelopes always include `code`, safe `message`, and `retryable`.

### 3.3 Telemetry signing & verification
MUST unit test:
- HMAC signature generation matches verification
- invalid signatures are rejected
- replay protections if implemented (timestamp window, eventId dedupe)
- canonicalization rules:
  - signature is computed over raw request bytes (not re-serialized JSON)

Acceptance:
- A single-byte change in payload invalidates signature.
- Signature verification is deterministic and constant-time where practical (or uses library that is).

### 3.4 Billing webhook verification
MUST unit test:
- signature verification function with known good vectors (valid payload, valid signature)
- invalid signature rejection
- idempotency handling (same event delivered twice)

Acceptance:
- A webhook without valid signature cannot change entitlements.
- Duplicate events do not create conflicting subscription state.

### 3.5 Entitlements and limit checking logic
MUST unit test:
- tier gating for runtimeProvider (AgentCore disabled on lower tiers)
- limit checks for requests/tokens/computeMs
- boundary conditions:
  - exactly at limit allowed/blocked as specified
  - above limit blocked with `LIMIT_EXCEEDED`
- concurrency model assumptions:
  - if you maintain counters, test atomic increments behavior (at least in a deterministic simulation)

Acceptance:
- Limit enforcement decisions are consistent and deterministic given the same inputs.

### 3.6 Cost estimation determinism
MUST unit test:
- cost estimators for each runtime (Cloudflare, AgentCore):
  - deterministic given same usage
  - monotonic: higher usage never yields lower cost
  - stable rounding rules (avoid drift across aggregates)

Acceptance:
- Same event inputs always produce identical `costUsdEstimated` within strict equality (or within a defined rounding epsilon).

---

## 4) Integration test plan (required)

Integration tests verify interactions between:
- control plane functions + DB
- provider adapters + external APIs (mocked and/or sandbox)
- telemetry ingestion + DB + aggregation
- billing webhooks + entitlements + gating

### 4.1 Control plane + DB integration
MUST test:
- Create user on first login (identity mapping)
- Agent CRUD:
  - create/list/get/update/disable/delete (soft delete recommended)
  - tenant isolation (cannot see others’ agents)
- Deployment record creation:
  - immutable fields remain unchanged
  - status transitions are correct
  - versioning monotonic per agent
- Active deployment pointer:
  - set on successful deploy
  - rollback/activate updates `activeDeploymentId`

Acceptance:
- DB invariants are maintained for all operations, including failure paths.

### 4.2 Telemetry ingestion integration
MUST test:
- Accept valid signed telemetry event:
  - event persisted
  - ownership validated (userId/agentId/deploymentId consistent)
- Reject invalid signature:
  - event not persisted
  - audit record created (if audit log implemented)
- Reject ownership mismatch (spoof attempt):
  - event not persisted

Acceptance:
- Telemetry endpoint cannot be used to write events for other tenants.

### 4.3 Aggregation integration
MUST test:
- Given a set of raw telemetry events for a period:
  - aggregation creates/updates `billingUsage` correctly
  - per-runtime breakdown correct
  - repeated aggregation is idempotent (same inputs -> same outputs)

Acceptance:
- Aggregation can be rerun without double-counting.

### 4.4 Billing webhook integration
MUST test:
- Valid webhook updates subscription tier and entitlements
- Invalid webhook rejected
- Replay of the same webhook does not double-apply changes
- Downgrade behavior (if implemented):
  - user over limit is blocked on next invoke (or grace period if configured)

Acceptance:
- Entitlements change only via verified webhooks.

### 4.5 Runtime adapter integration (mocked)
MUST test adapters with provider API mocks to validate:
- correct request shapes sent to providers
- correct mapping of provider responses into normalized outputs
- correct error normalization
- idempotency on deploy (retry same deploymentId)
- gating behavior (adapter refuses when not entitled)

Acceptance:
- Adapters implement the Runtime Provider Interface contract correctly even when provider behaviors vary.

### 4.6 Runtime adapter integration (sandbox live)
SHOULD test (at least in staging nightly):
- Cloudflare:
  - deploy fixture agent
  - invoke stateless
  - invoke sessionful (sessionId roundtrip)
  - telemetry emitted and accepted
- AgentCore:
  - deploy fixture agent to AgentCore using the **TypeScript AWS SDK** (control-plane adapter path)
  - invoke (with and without session) and verify:
    - the adapter correctly maps opaque `sessionId` ↔ provider session identifier
    - session expiration/unknown session returns a normalized `RUNTIME_ERROR` with a safe message and `retryable=false`
  - telemetry produced (adapter-side or in-workload, depending on design)
  - tool-enabled invocation tests (only if the deployment enables these capabilities; otherwise skip with a clear reason):
    - Code Interpreter: prompt asks for a deterministic computation (e.g., fibonacci(10) or sum 1..100) and asserts the expected numeric result appears
    - Browser tool: prompt asks to visit `https://example.com` and extract a deterministic string (e.g., page title “Example Domain”)
    - usage asserts include `toolCalls > 0` (or provider-specific equivalent normalized into usage)

Acceptance:
- A real deploy+invoke works end-to-end for each provider in staging.
- For AgentCore, TypeScript deployment + tool-enabled invocation scenarios pass when the tier and deployment configuration enable them.

---

## 5) End-to-end (E2E) test plan (required)

E2E tests validate the “it works for a user” flows. These can be implemented via browser automation + API checks or API-only E2E flows with authenticated sessions.

### 5.1 E2E baseline flows (MUST)
#### Flow E2E-01: Signup/login → create agent
Steps:
1. Authenticate (create a new user if needed).
2. Create agent with runtimeProvider=cloudflare and envVarKeys including `OPENAI_API_KEY` (value not yet set).
3. Verify agent appears in list and detail view.

Assertions:
- Agent created with status `created`.
- Tenant isolation: agent is only visible to the authenticated user.

#### Flow E2E-02: Set secrets → deploy → invoke (Cloudflare)
Steps:
1. Set secrets for the agent (write-only).
2. Deploy fixture agent bundle.
3. Wait/poll until deployment status is `active`.
4. Invoke the agent with a simple prompt.
5. Verify response is correct and deterministic.

Assertions:
- Deployment record exists and transitions `deploying` -> `active`.
- Agent `activeDeploymentId` set to deployment.
- Invocation returns `output.text` and `traceId`.
- Telemetry event is recorded and attributable to user/agent/deployment.
- No secret values appear in logs or responses.

#### Flow E2E-03: Metrics/usage visible in dashboard
Steps:
1. After one or more invocations, query usage endpoint for current period.
2. Query agent metrics series for a time range including invocation.

Assertions:
- Usage totals show requests >= number of invocations performed.
- Metrics series includes the invocation bucket with tokens/computeMs populated (estimated allowed).
- Cost is labeled as estimated (UI/contract semantics).

#### Flow E2E-04: Rollback to previous deployment
Steps:
1. Deploy fixture agent v1.
2. Deploy fixture agent v2 (different deterministic output).
3. Invoke and observe v2 output.
4. Activate v1 deployment (rollback).
5. Invoke and observe v1 output.

Assertions:
- Agent `activeDeploymentId` updates correctly.
- Invocation routing follows active deployment.
- Deployment history preserved and immutable.

### 5.2 E2E billing/limits flows (MUST)
#### Flow E2E-05: Limit enforcement blocks invocations
Setup:
- Set an intentionally low requests limit for a test tier, or create a special test user entitlement override.

Steps:
1. Invoke agent until the limit is reached.
2. Attempt one additional invocation.

Assertions:
- Extra invocation is blocked with `LIMIT_EXCEEDED`.
- Error envelope includes `limitType`, `periodKey`, and safe message.
- No provider invocation occurs after limit exceeded (verify via mock or provider logs where feasible).

#### Flow E2E-06: Runtime gating blocks AgentCore deploy/invoke
Setup:
- User is on a tier with `agentcoreEnabled=false`.

Steps:
1. Create agent with runtimeProvider=agentcore (or attempt to change to agentcore).
2. Attempt to deploy to AgentCore.
3. Attempt to invoke.

Assertions:
- Deploy blocked with `LIMIT_EXCEEDED` (or a dedicated entitlement error) before provider calls.
- Invoke blocked.
- UI reflects gating appropriately (nice-to-have, but backend enforcement is authoritative).

### 5.3 E2E AgentCore flows (SHOULD for staging)
#### Flow E2E-07: Deploy/invoke on AgentCore (entitled user)
Setup:
- User on tier with `agentcoreEnabled=true`.

Steps:
1. Create agent with runtimeProvider=agentcore.
2. Deploy fixture agent to AgentCore.
3. Invoke and verify response.
4. Verify telemetry recorded with runtimeProvider=agentcore.

Assertions:
- Works end-to-end and usage shows up in period totals with correct runtime breakdown.

---

## 6) Security-focused test suite (required)

### 6.1 Tenant isolation (IDOR) tests (MUST)
For each endpoint that accepts `agentId`/`deploymentId`:
- Attempt to access another user’s resource id.

Assertions:
- Returns `NOT_FOUND` (preferred) or `UNAUTHORIZED` consistently.
- No resource data is leaked (even partial metadata).

Endpoints to include:
- agent get/update/disable/delete
- deployments list/get/activate/logs
- metrics series endpoints
- usage endpoints scoped by agent/deployment

### 6.2 Secrets leakage tests (MUST)
- Set secrets with distinctive sentinel values.
- Trigger common operations: deploy, invoke, errors, metrics.
- Search logs, error responses, telemetry events, audit logs, and UI-visible fields.

Assertions:
- Sentinel values never appear in:
  - error messages returned to client,
  - stored logs/metrics payloads,
  - audit log metadata.

### 6.3 Webhook spoofing tests (MUST)
- Send webhook payload with invalid signature.
- Attempt to elevate tier.

Assertions:
- Tier unchanged.
- Response is `UNAUTHENTICATED` (or equivalent).
- An audit log entry is created (optional but recommended).

### 6.4 Telemetry spoofing tests (MUST)
- Send telemetry with invalid signature.
- Send telemetry with valid signature but mismatched attribution (agentId from other user).
- Send telemetry replay (same signature/payload) if anti-replay implemented.

Assertions:
- Invalid signature rejected.
- Ownership mismatch rejected.
- Replay either deduped or rejected (depending on implementation).

---

## 7) Resilience and failure-mode tests (required)

### 7.1 Provider failure during deploy
Simulate provider error:
- Cloudflare API failure
- AgentCore API failure

Assertions:
- Deployment status becomes `failed`.
- Agent status becomes `error` (or remains unchanged if you prefer per-agent status behavior).
- Error message is sanitized and actionable.
- Retrying deploy with same idempotency key is safe (does not create duplicate deployments or inconsistent versions).

### 7.2 Provider failure during invoke
Simulate invoke failure:
- provider timeout
- runtime exception
- tool error (AgentCore tools if applicable)

Assertions:
- Invocation returns `RUNTIME_ERROR` with retryable correctly set.
- Telemetry indicates `errors=1` and errorClass appropriate.
- System does not crash and does not leak provider internals.

### 7.3 Telemetry ingestion outage
Simulate telemetry ingestion temporarily down.
- For Pattern A (runtime emits), telemetry call fails.

Assertions:
- Invocation still returns success to client.
- The system records an internal error or audit event for telemetry failure (if designed).
- No secret leakage occurs.
- (Optional) Retry behavior is bounded and does not cause runaway loops.

### 7.4 Concurrency tests
- Concurrent invocations at/near limit boundary.
- Concurrent deploy attempts on the same agent.

Assertions:
- Limit checks behave conservatively; small overruns may be tolerated but must not be systematic.
- Concurrent deploy is prevented or fails with `CONFLICT`.
- Deployment versions remain monotonic and unique.

---

## 8) Performance and load testing (recommended)

### 8.1 Invocation gateway latency
Measure p50/p95 for:
- auth + routing overhead
- provider invoke time (separately where possible)

Acceptance target (initial):
- control-plane routing overhead small relative to provider time; track as a metric rather than hard-failing builds.

### 8.2 Telemetry throughput
- Burst telemetry ingestion tests (e.g., N events/sec).
- Verify DB write capacity and aggregation staleness under load.

Acceptance:
- Telemetry ingestion remains stable or degrades gracefully (429/retryable) without corrupting data.

---

## 9) Release gates (must-pass checklist)

A release to production MUST NOT proceed unless:
1. **Tenant isolation** tests pass for all relevant endpoints.
2. **Webhook verification** tests pass and no unsigned webhook can change tier.
3. **Telemetry signature verification** tests pass and spoofed telemetry is rejected.
4. **Secrets leakage** tests pass (no sentinel secret appears anywhere it shouldn’t).
5. **Deploy+invoke E2E** passes on Cloudflare in staging.
6. **Limit enforcement** E2E passes (requests limit at minimum).
7. **Rollback** E2E passes.
8. **Error normalization** is consistent (no raw provider errors in client responses).

If AgentCore is enabled in production:
- AgentCore staging E2E deploy+invoke MUST pass.

---

## 10) Acceptance criteria (overall system “v1 complete”)

The platform is considered v1-complete when all of the following are true:

### 10.1 Core user journey
- A user can authenticate, create an agent, set secrets (write-only), deploy to Cloudflare, invoke it, and see usage/metrics in the dashboard.

### 10.2 Deployments are immutable and rollback works
- Deployments are recorded as immutable versions.
- An agent has a single active deployment pointer.
- Rollback updates the pointer and changes invocation routing immediately.

### 10.3 Limits and tier gating are enforced
- Requests limits are enforced at invocation time and block further invocations when exceeded.
- AgentCore deploy/invoke is gated by tier entitlements and cannot be bypassed by direct API calls.

### 10.4 Telemetry and billing integrity
- Every invocation produces a telemetry event (or is accounted for deterministically).
- Telemetry ingestion verifies signatures and ownership.
- Billing webhooks verify signatures and are idempotent.

### 10.5 Secrets are protected
- No plaintext secrets are stored in the primary DB.
- No secret values appear in logs, telemetry, error responses, or audit metadata.

### 10.6 Failure modes are safe
- Provider failures do not corrupt state.
- Errors are normalized and sanitized.
- Retries are safe for deploy and telemetry ingestion.

---

## 11) Appendix: Minimal test matrix (quick reference)

### Unit (must)
- Validation: agents, manifest, invoke payload
- Error mapping: provider -> normalized
- Signature verify: telemetry and billing
- Limit checks: thresholds and boundary cases
- Cost estimation: determinism + monotonicity

### Integration (must)
- CRUD + tenant isolation
- Deploy record + active pointer
- Telemetry ingestion + ownership cross-check
- Aggregation idempotency
- Webhook signature + idempotency
- Adapter with mocks: deploy/invoke shapes + error mapping

### E2E (must)
- Create agent -> set secrets -> deploy -> invoke -> view usage
- Limit enforcement blocks
- Rollback changes routing

### E2E (should)
- AgentCore deploy+invoke (entitled user)
- Streaming invoke (if implemented)

---