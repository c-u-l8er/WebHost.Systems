# webhost.systems — Runtime Provider Interface (RPI) & Adapter Guidance (v1)
Version: 1.0  
Status: Implementation-ready  
Last updated: 2026-01-21

This document defines the **Runtime Provider Interface (RPI)**: the contract between the webhost.systems control plane and each runtime provider (e.g., Cloudflare Workers/DO, AWS Bedrock AgentCore). It also provides concrete guidance for implementing provider adapters, including deployment, invocation (streaming + non-streaming), telemetry, secrets, timeouts, idempotency, and error normalization.

Normative language: MUST, MUST NOT, SHOULD, MAY.

---

## 1) Goals & non-goals

### 1.1 Goals
The RPI exists to ensure:
- consistent invocation semantics across runtimes (including sessions),
- consistent telemetry/cost attribution,
- a single control-plane flow for deploy → activate → invoke → observe,
- minimal lock-in to any one provider.

### 1.2 Non-goals
- The RPI does not mandate a specific LLM SDK or “agent framework” inside the data plane.
- The RPI does not attempt to unify every provider-specific feature (e.g., AgentCore tool ecosystem) into one universal surface in v1.
- The RPI does not define the UI. It defines backend behavior and contracts.

---

## 2) Key concepts

### 2.1 Control plane vs data plane
- **Control plane** (Convex + web backend) owns: authentication, authorization, deployments, agent metadata, plan enforcement, telemetry ingestion, aggregation, and billing.
- **Data plane** (Cloudflare/AgentCore) owns: executing user agent code and reporting telemetry events.

### 2.2 Provider adapter
A **provider adapter** is control-plane code that:
- deploys user code to a provider,
- invokes the currently active deployment on that provider,
- maps provider responses/errors into the normalized webhost.systems contract,
- ensures the deployed workload is configured to emit telemetry securely.

### 2.3 Session
All sessions are represented externally as an opaque string `sessionId`. The meaning is provider-specific:
- Cloudflare: Durable Object id / instance key
- AgentCore: runtime session id

The control plane MUST treat `sessionId` as opaque and MUST NOT attempt to parse it.

---

## 3) RPI: canonical types (normative)

> These are *spec-level* types. Implementation languages may vary, but shapes and semantics MUST be preserved.

### 3.1 Provider identifiers
- `RuntimeProvider = "cloudflare" | "agentcore"`

### 3.2 Artifact reference
A deployment is driven by an artifact reference. v1 supports at least uploaded bundles; repo refs are optional.

- `ArtifactRef.type = "uploaded_bundle" | "repo_ref"`
- For `uploaded_bundle`: `uploadId` (opaque), `checksum`, `sizeBytes`
- For `repo_ref`: `githubUrl`, `ref`, optional `commitHash`

### 3.3 Deploy input/output
**DeployInput (MUST include):**
- `userId`, `agentId`, `deploymentId`, `deploymentVersion`
- `runtimeProvider`
- `artifactRef`
- `agentConfig` (non-secret config, including protocol version)
- `env`:
  - `plain`: non-secret env vars (optional)
  - `secretKeys`: list of keys expected to exist in provider secret store
- `telemetry`:
  - `endpointUrl` (control-plane telemetry ingestion URL)
  - `deploymentId` (for signature and attribution)
  - `telemetryAuth` (provider-injected secret reference or signing config; see §7)

**DeployOutput (MUST include):**
- `providerRef`: runtime-specific reference needed for invocation
- `status`: `succeeded | failed`
- `error?`: normalized error (see §6)

### 3.4 Invoke input/output
**InvokeInput (MUST include):**
- `userId`, `agentId`, `deploymentId`
- `runtimeProvider`
- `providerRef`
- `request`:
  - `input`: either `{ messages: [...] }` or `{ prompt: string }` (server may normalize)
  - `sessionId?`
  - `options?` (e.g., maxSteps, temperature)
  - `metadata?` (traceId, client metadata)
- `limitsContext`:
  - plan tier info and remaining budgets (or a handle to check budgets)
- `timeouts`:
  - `overallMs` (hard cap enforced by control plane gateway)
  - provider-specific timeouts (optional)

**InvokeOutput (MUST include):**
- `response`:
  - `output.text`
  - `sessionId?` (new/continued)
  - `usage?` (tokens/computeMs/toolCalls when available)
  - `traceId`
- `providerDiagnostics?` (internal-only; MUST NOT leak to untrusted clients)
- `error?` (if failed; normalized)

### 3.5 Streaming invocation
If streaming is supported:
- Adapter MUST provide a streaming pathway that emits:
  - `meta` (traceId/sessionId)
  - `delta` chunks (text)
  - `usage` (final summary)
  - `done`
  - `error` (normalized envelope)

If streaming is not supported by the provider:
- Adapter MAY emulate streaming by chunking buffered output, but MUST still emit the correct event ordering and ensure consistent final `usage`.

---

## 4) RPI required adapter surface (normative)

Each provider adapter MUST implement the following capabilities.

### 4.1 `deploy`
Responsibilities:
1. Validate artifact and agent config compatibility with provider constraints.
2. Provision or update provider resources to host the deployment.
3. Inject required environment and telemetry configuration.
4. Return a `providerRef` that can be used to invoke.

MUST:
- be safe to retry (idempotent by deploymentId; see §5.2)
- never store plaintext secrets in control plane storage
- sanitize provider errors before returning them

### 4.2 `invoke`
Responsibilities:
1. Enforce request-level constraints (payload size, session policy, timeouts).
2. Route to provider runtime for the active deployment.
3. Normalize output and errors.
4. Ensure telemetry is emitted (either by runtime workload or by adapter, depending on architecture; see §8).

MUST:
- include `traceId` in provider request if possible
- return an opaque `sessionId` when a new session is created
- enforce plan limits (control plane responsibility; adapter must accept a “limits decision” or consult a limits service)

### 4.3 `healthcheck`
Responsibilities:
- Provide a lightweight readiness signal for provider integration (credentials/config present, basic API reachability).

MUST:
- avoid expensive calls
- never require deploying user code

### 4.4 `estimateCost` (MVP)
Responsibilities:
- Convert `usage` into an estimated USD cost for telemetry.

MUST:
- label estimates as estimates; do not imply reconciliation
- be deterministic given the same usage inputs

---

## 5) Cross-cutting concerns

### 5.1 Versioning
- The invocation protocol version MUST be declared in the deployment manifest (e.g., `protocol: "invoke/v1"`).
- Adapters MUST reject unsupported protocol versions with `INVALID_REQUEST`.

### 5.2 Idempotency and retries (deploy)
Deploy operations MUST be idempotent per `(deploymentId, provider)`:
- If the same deployment is redeployed due to retry, the adapter MUST return the same `providerRef` when safe, or MUST produce a semantically equivalent deployment and update the deployment record accordingly.
- Adapter SHOULD use provider tagging/labels to locate already-created resources.

### 5.3 Timeouts
- Control plane MUST enforce `overallMs` timeout on invocations.
- Adapter MUST also set provider-side timeouts where available to avoid runaway compute.

Recommended defaults (tune per provider):
- Cloudflare: overall 30–60s for typical requests; sessionful flows may be longer within provider constraints.
- AgentCore: allow longer (minutes to hours) only on entitled tiers; still enforce a sane `overallMs` for the HTTP gateway and provide async job patterns post-v1 if needed.

### 5.4 Payload limits
Adapter MUST validate:
- maximum request JSON size
- maximum message count and message length (to avoid abuse)
- maximum output size (streaming preferred for large output)

### 5.5 Concurrency & backpressure
- Adapter SHOULD implement basic backpressure handling:
  - reject with `RATE_LIMITED` or `RUNTIME_ERROR` when provider capacity is exceeded,
  - include `retryable=true` where appropriate.
- Control plane SHOULD apply per-user and per-agent rate limits (even if not in MVP).

---

## 6) Error normalization (normative)

Adapters MUST normalize provider errors into the webhost.systems error envelope with these codes:

- `UNAUTHENTICATED` / `UNAUTHORIZED` (control plane usually handles)
- `NOT_FOUND` (missing deployment/provider resource)
- `INVALID_REQUEST` (bad input shape, unsupported protocol)
- `CONFLICT` (deployment in progress, invalid state)
- `LIMIT_EXCEEDED` (plan gate; control plane)
- `DEPLOYMENT_FAILED` (provider deploy failure)
- `RUNTIME_ERROR` (invoke failure, tool failure, provider errors)
- `INTERNAL` (unexpected)

Rules:
1. Never return raw provider exceptions directly to clients.
2. Include provider request ids in internal diagnostics only.
3. Mark `retryable` accurately:
   - transient provider errors: `retryable=true`
   - validation/config errors: `retryable=false`

---

## 7) Secrets and configuration (normative)

### 7.1 Secret storage rule
Plaintext secrets MUST NOT be stored in the control plane database.

The control plane may store:
- secret key names (`envVarKeys`)
- secret references (provider-specific identifiers)
- rotation metadata (timestamps, last rotated by, etc.)

### 7.2 Provider injection
Adapters MUST ensure secrets are injected into the runtime using provider-native mechanisms:

- Cloudflare:
  - Worker secrets (bound at deploy time via provider API)
- AgentCore:
  - AWS-native secret mechanisms (e.g., Secrets Manager) or AgentCore-supported injection (implementation-dependent)

### 7.3 Secret rotation
- Rotating a secret MAY require a redeploy depending on provider.
- Adapters SHOULD document whether redeploy is required and provide a safe path.

---

## 8) Telemetry (normative)

### 8.1 Telemetry objectives
Every invocation MUST result in a telemetry event that is:
- attributable to `{ userId, agentId, deploymentId, runtimeProvider }`,
- integrity-protected against spoofing,
- sufficient to enforce limits and compute estimated cost.

### 8.2 Telemetry emission patterns (choose one per provider)
**Pattern A — In-workload reporting (preferred for Cloudflare DO):**
- The deployed worker/DO calls `POST /v1/telemetry/report` after each invocation.

**Pattern B — Adapter-side reporting (fallback / interim):**
- Adapter emits telemetry after receiving provider response.
- Use only if provider response includes enough usage data and you can attribute compute reliably.

Cloudflare typically fits Pattern A; AgentCore may fit either depending on SDK capabilities and where you can best capture tool usage and session duration.

### 8.3 Telemetry authentication (MVP requirement)
Telemetry ingestion MUST reject spoofed events.

MVP approach:
- Each deployment has a `telemetrySecret` injected into the runtime.
- Runtime signs telemetry payload:
  - `X-Telemetry-Signature: v1=<HMAC_SHA256(body, telemetrySecret)>`
  - `X-Telemetry-Deployment-Id: <deploymentId>`
- Control plane validates signature using the secret reference for that deployment.

### 8.4 Telemetry schema (minimum viable)
Telemetry event MUST include:
- `timestamp`
- `requests` (typically 1)
- `llmTokens` (provider-reported preferred; estimated allowed)
- `computeMs` (wall time or billed compute time)
- `errors` + `errorClass`
- `costUsd` (estimated allowed)
- `traceId` (if available)

Provider-specific optional:
- Cloudflare: DO ops, Workers AI calls
- AgentCore: session duration, tool invocations, browser interactions

---

## 9) Deployment packaging and runtime expectations

### 9.1 Required manifest
Each artifact MUST include `agent.config.json` (or an equivalent manifest) with:
- `protocol: "invoke/v1"`
- `runtime: "cloudflare" | "agentcore"`
- `entrypoint`
- `env.requiredKeys` and `env.optionalKeys`
- `capabilities.streaming`, `capabilities.tools` (booleans)

Adapter MUST validate:
- manifest exists and is parseable
- manifest runtime matches selected runtime provider
- required env keys are declared

### 9.2 Entrypoint contract (data plane)
The deployed code MUST expose a handler compatible with the selected runtime provider.

The *behavioral* contract is:
- Accept `InvokeRequest` input (messages/prompt, session id)
- Return `InvokeResponse` output (text, session id, usage if available)
- Respect timeouts and limits communicated via env/config where applicable
- Emit telemetry (if Pattern A)

Adapters MAY provide thin runtime shims/templates that wrap user code into provider-specific handlers.

---

## 10) Provider-specific guidance

## 10.1 Cloudflare Workers + Durable Objects adapter

### 10.1.1 Recommended architecture
- A Worker acts as the HTTP entrypoint.
- A Durable Object (DO) holds per-session state (conversation history, tool state, caches).
- `sessionId` maps to a DO id.

### 10.1.2 Deploy responsibilities
Adapter SHOULD:
- create/update Worker script with bundled code
- bind:
  - DO namespace
  - secrets (telemetry secret, user-provided secrets like model keys)
  - non-secret env vars
- ensure the Worker/DO is configured with:
  - `TELEMETRY_ENDPOINT_URL`
  - `TELEMETRY_DEPLOYMENT_ID`
  - `TELEMETRY_SECRET` (provider secret)
  - optional `CONTROL_PLANE_BASE_URL` for any necessary callbacks

### 10.1.3 Invoke responsibilities
- Invocation gateway may call the Worker URL directly (server-to-server).
- For sessionful calls:
  - if `sessionId` present: route to that DO instance
  - else: generate a new DO instance id and return it
- Ensure telemetry emission:
  - DO should emit telemetry at the end of each request with signature.

### 10.1.4 Streaming
Cloudflare supports streaming responses well. Adapter SHOULD:
- support SSE from invocation gateway to client
- pass through provider streaming where possible, else stream from buffered output

### 10.1.5 Limitations
Adapter MUST account for provider constraints (examples; confirm with current provider limits during implementation):
- max CPU time
- memory limits
- maximum request/response sizes
- DO concurrency patterns and potential hot-key issues

---

## 10.2 AWS Bedrock AgentCore adapter

### 10.2.1 Recommended architecture
- Control plane creates and manages AgentCore runtime resources using AWS SDK (TypeScript-supported).
- Invocations call AgentCore runtime APIs.
- Optional: integrate AgentCore tools SDK (code interpreter, browser tools) for premium tiers.

### 10.2.2 Deploy responsibilities
Adapter MUST:
- create/update the AgentCore runtime (or deployment unit) for the agent/deployment
- store the provider reference (`agentRuntimeArn` / runtime id) as `providerRef`
- configure secrets via AWS-native mechanisms (preferred)
- configure telemetry:
  - either in-workload reporting (if your runtime code can call out) OR
  - adapter-side reporting (if sufficient usage data is returned)

### 10.2.3 Invoke responsibilities
- Map `sessionId` to AgentCore runtime session id.
- Ensure `traceId` is propagated as metadata where supported.
- Normalize usage reporting:
  - tokens, session duration, tool calls (if available)
- Normalize tool errors into `RUNTIME_ERROR` with safe messaging.

### 10.2.4 Streaming
Depending on the AgentCore invoke API capabilities:
- If streaming supported: forward as SSE.
- If not: return buffered responses; optionally emulate streaming.

### 10.2.5 Tier gating
AgentCore usage SHOULD be restricted to higher tiers by policy:
- free/starter/pro: Cloudflare default
- enterprise (or higher): AgentCore enabled

Adapter MUST refuse deploy/invoke if the user is not entitled (control plane should prevent routing, but adapter must still be safe).

---

## 11) Adapter implementation checklist (do-this-not-that)

### 11.1 MUST checklist
- [ ] Validate runtime entitlement before deploy and invoke.
- [ ] Enforce deployment immutability: new deploy = new deployment id/version.
- [ ] Ensure deploy is idempotent (retry-safe).
- [ ] Never persist plaintext secrets.
- [ ] Ensure telemetry integrity (sign events).
- [ ] Normalize all errors with correct `retryable` flag.
- [ ] Always include or generate `traceId`.
- [ ] Ensure session ids are opaque and stable.

### 11.2 SHOULD checklist
- [ ] Tag/label all provider resources with `{userId, agentId, deploymentId}` for cleanup and audits.
- [ ] Provide a best-effort cleanup/deprovision method for agent deletion.
- [ ] Implement exponential backoff on transient provider failures.
- [ ] Provide provider diagnostics internally (request ids) without leaking to clients.

### 11.3 MUST NOT checklist
- [ ] MUST NOT allow telemetry spoofing (unsigned events).
- [ ] MUST NOT leak secret values in logs/errors.
- [ ] MUST NOT permit cross-tenant access via provider resource naming collisions.

---

## 12) Testing requirements (adapter-focused)

### 12.1 Unit tests
- Deploy input validation and manifest parsing
- Error mapping table (provider error → normalized code)
- Telemetry signature generation/verification
- Cost estimation determinism

### 12.2 Integration tests (per provider)
Cloudflare:
- Deploy a minimal agent
- Invoke stateless and sessionful
- Verify telemetry event accepted and stored
- Verify streaming path (if implemented)

AgentCore:
- Deploy a minimal agent
- Invoke with and without session
- Verify usage extraction and telemetry
- Verify tier gating (deploy/invoke rejected when not entitled)

### 12.3 Failure-mode tests
- Invalid manifest → `INVALID_REQUEST`
- Provider auth failure → `DEPLOYMENT_FAILED` or `RUNTIME_ERROR` with `retryable=false` (depending on operation)
- Transient provider outage → `RUNTIME_ERROR` with `retryable=true`
- Telemetry with bad signature → rejected

---

## 13) Future extensions (post-v1)
- Add additional runtime providers (e.g., another cloud or container-based runtime) by implementing the same adapter surface.
- Add async jobs for long-running invocations (queue + callback/webhook/polling).
- Add public agents via API keys, with per-agent rate limiting and usage attribution.
- Add billing reconciliation via provider exports to convert cost from estimated → reconciled.

---