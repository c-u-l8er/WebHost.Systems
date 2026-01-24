# ADR-0006: Canonical Invocation Protocol (invoke/v1) and Streaming Strategy
Status: Accepted (v1)  
Date: 2026-01-21  
Decision Makers: Engineering  
Related Docs:
- `WebHost.Systems/project_spec/spec_v1/00_MASTER_SPEC.md`
- `WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md`
- `WebHost.Systems/project_spec/spec_v1/20_RUNTIME_PROVIDER_INTERFACE.md`
- `WebHost.Systems/project_spec/spec_v1/50_OBSERVABILITY_BILLING_LIMITS.md`
- `WebHost.Systems/project_spec/spec_v1/40_SECURITY_SECRETS_COMPLIANCE.md`
- `WebHost.Systems/project_spec/spec_v1/adr/ADR-0008-delegated-invocation-auth.md` (delegated invocation auth mode; preserves invoke/v1 semantics)

## Context

webhost.systems is a multi-runtime platform for deploying and running customer AI agents. The system must route invocations through a control plane to one of multiple data plane runtime providers (initially Cloudflare Workers/DO and AWS Bedrock AgentCore), while maintaining:

- a stable external API for clients and the dashboard,
- consistent session semantics across runtimes,
- consistent telemetry attribution and usage/cost accounting,
- safe error handling and sanitization,
- optional streaming output for good UX.

Without a canonical invocation protocol, each runtime will expose different request/response shapes (prompt-only vs message arrays, provider-specific session concepts, different streaming models, tool call shapes). This would make:
- the invocation gateway hard to implement and evolve,
- SDKs hard to write,
- telemetry inconsistent,
- limit enforcement unreliable.

We need a single “invoke contract” that the control plane and adapters can enforce, plus an explicit streaming model that works across runtimes.

## Decision

### 1) Adopt a canonical invocation protocol: `invoke/v1`

All invocations in webhost.systems use a single protocol version identifier:

- `protocol = "invoke/v1"`

The protocol applies to:
- the invocation gateway API (client -> control plane),
- the internal Runtime Provider Interface (control plane -> provider adapters),
- the runtime payloads (as applicable) for data plane execution,
- telemetry correlation via `traceId`.

Note: Additional authentication modes (e.g., delegated server-to-server invocation) MUST NOT introduce a new protocol shape. They preserve the same `invoke/v1` request/response semantics and differ only in how the invocation gateway authenticates and attributes the caller. See `ADR-0008-delegated-invocation-auth.md`.

### 2) Canonical input: chat messages (with prompt convenience)

`invoke/v1` defines the canonical input shape as chat `messages`:

- `input.messages: Array<{ role, content }>`
  - `role ∈ { "system", "user", "assistant", "tool" }`
  - `content: string`

Additionally, for client convenience, `invoke/v1` allows a `prompt` form:

- `input.prompt: string`

When `prompt` is provided, the control plane MUST normalize it to:

- `messages = [{ role: "user", content: prompt }]`

Rationale:
- “messages” is compatible with most modern LLM/agent frameworks,
- it supports future tool call and transcript semantics,
- it avoids provider-specific payload drift.

### 3) Session semantics: opaque `sessionId`

`invoke/v1` standardizes stateful execution via an opaque `sessionId` string:

- Clients MAY include `sessionId` to continue a prior session.
- If omitted, the system MAY create a new session and return a new `sessionId`.

Rules:
- `sessionId` is opaque; clients MUST NOT parse it.
- The control plane MUST treat it as opaque and MUST NOT embed meaning or routing logic in the `sessionId` string.
- Each runtime provider maps `sessionId` to its own session primitive:

  - Cloudflare: Durable Object id / instance key
    - Session state is stored in Durable Object storage.
    - `sessionId` typically maps 1:1 to a DO instance identifier.

  - AgentCore: AgentCore runtime session identifier (e.g., `runtimeSessionId`)
    - AgentCore is TypeScript-capable end-to-end (control plane and runtime integration), so the adapter SHOULD use the official TypeScript AWS SDK to invoke sessions.
    - The adapter MUST treat the `sessionId` as a provider runtime session id and pass it through to invocation calls.
    - If `sessionId` is not provided, the adapter SHOULD create one (or let the provider return one) and return it to the client as the opaque `sessionId`.
    - Session expiration MUST be handled gracefully and consistently:
      - if the provider indicates “unknown/expired session”, return a normalized `RUNTIME_ERROR` with a safe message such as “Session expired” and `retryable=false` (do not leak provider internals).

Implementation note (AgentCore TypeScript invocation shape, conceptual):
- Invoke with the deployment’s AgentCore runtime reference (e.g., `agentRuntimeArn`) and a `runtimeSessionId` set to the opaque `sessionId` (or a newly generated one if absent).
- Example fields you will typically populate via the TypeScript AWS SDK:
  - `agentRuntimeArn: <from deployment.providerRef.agentcore.agentRuntimeArn>`
  - `runtimeSessionId: sessionId || <new session id>`
  - `payload: <encoded invoke/v1 request JSON>`

### 4) Canonical output: text-first

`invoke/v1` defines the canonical output as:

- `output.text: string` (required)

Optionally:
- `output.messages?: transcript array` (MAY in v1; SHOULD be added later only if stable across runtimes)

Rationale:
- text-first is sufficient for v1 UX and reduces cross-runtime complexity.
- transcript support can be added later without breaking existing clients.

### 5) Usage and correlation are first-class

Every `invoke/v1` response MUST include:
- `traceId: string` (generated by the invocation gateway if not provided)

Response SHOULD include:
- `usage.tokens?: number`
- `usage.computeMs?: number`
- `usage.toolCalls?: number` (or provider-specific tooling counters normalized when available)

Telemetry events MUST include the same `traceId` when available, and MUST be attributable to:
- `{ userId, agentId, deploymentId, runtimeProvider, timestamp }`

### 6) Streaming strategy: SSE as the standard transport

`invoke/v1` defines streaming semantics via **Server-Sent Events (SSE)** on a dedicated streaming endpoint:

- `POST /v1/invoke/{agentId}/stream`
- `Accept: text/event-stream`

Standard SSE event types:

- `meta` (MUST be first)
  - includes `traceId` and `sessionId` (if known at start)
- `delta` (0..N)
  - includes incremental output text chunks
- `usage` (0..1; SHOULD be emitted before done)
  - includes final usage summary when available
- `done` (MUST be last on success)
- `error` (terminal on failure)
  - includes the normalized error envelope

If a runtime provider supports true streaming:
- the adapter SHOULD pass-through streaming (mapping provider stream to `delta` events).

If a runtime provider does not support streaming:
- the adapter MAY emulate streaming by buffering and chunking output, but MUST preserve ordering and terminal events.

Rationale:
- SSE is widely supported, simple, and works well for “text token streaming”.
- A consistent event schema enables a unified client and UI implementation.

## Alternatives considered

### A) Prompt-only protocol
Pros:
- simplest request shape

Cons:
- loses structured conversation context
- complicates future tool call integration
- diverges from modern agent UX and frameworks

Rejected because messages are the better canonical baseline with a prompt convenience fallback.

### B) Provider-specific protocols per runtime
Pros:
- maximum leverage of each provider’s features

Cons:
- breaks portability and unified SDKs
- complicates limit enforcement and telemetry
- increases maintenance and user confusion

Rejected because webhost.systems differentiates on portability and unified control plane semantics.

### C) WebSockets for streaming
Pros:
- bidirectional, flexible

Cons:
- more operational complexity (connection state, proxies)
- not necessary for v1
- harder to support across platforms and edge gateways

Rejected for v1; SSE is sufficient for streaming output. WebSockets can be introduced later if interactive tool call UX requires it.

### D) gRPC for invocation
Pros:
- strict contracts, performance

Cons:
- browser compatibility constraints
- higher adoption friction
- more infrastructure requirements

Rejected for v1; HTTP+JSON and SSE are simpler and adequate.

## Consequences

### Positive
- Stable, runtime-agnostic contract for clients and SDKs.
- Simplifies the invocation gateway and adapter logic (one normalized shape).
- Enables consistent telemetry attribution and usage accounting.
- Makes streaming UX consistent across runtimes.

### Negative / tradeoffs
- Some provider-native features won’t map cleanly to v1 without extensions (e.g., tool call transcripts).
- Streaming emulation may not reflect true token-level timing for non-streaming providers.
- Token counts and usage fields may be estimated or unavailable for some providers; must be communicated as such.

## Implementation details (normative requirements)

### 1) Protocol versioning
- Every deployment artifact manifest MUST declare `protocol: "invoke/v1"`.
- The control plane MUST reject deployments with unknown protocol versions (`INVALID_REQUEST`).

### 2) Request normalization rules
- If `input.prompt` provided and `input.messages` missing:
  - normalize to one user message.
- If both are provided:
  - prefer `messages` and ignore `prompt` (or reject as invalid; choose one consistent policy; v1 recommendation: reject with `INVALID_REQUEST` to avoid ambiguity).

### 3) Session rules
- If `sessionId` is present:
  - adapter MUST attempt to continue that session in the provider.
  - adapter MUST treat `sessionId` as opaque and MUST NOT parse or re-encode it.
  - if the provider rejects session id as unknown/expired:
    - return `RUNTIME_ERROR` with `retryable=false` (v1 canonical behavior) and a safe message such as “Session expired”.
    - do not leak provider error details or identifiers to the client.

- If `sessionId` is absent:
  - adapter MAY start a new session and MUST return the new `sessionId` if created.
  - AgentCore-specific guidance (TypeScript):
    - the adapter SHOULD set `runtimeSessionId` explicitly on invocation (e.g., `sess_<generated>`), or accept a provider-returned session id if the API returns one.
    - the adapter MUST return the session identifier to the client as the opaque `sessionId` for subsequent calls.

- Session lifecycle and timeouts:
  - adapters SHOULD document provider-specific session lifetimes and idle timeouts (in internal docs and/or UI hints) but MUST keep the external `invoke/v1` contract stable.

### 4) Streaming rules
- Streaming endpoint MUST:
  - send `meta` as first event,
  - send `done` as last event on success,
  - send `error` as terminal event on failure.
- Even on streaming:
  - gateway MUST still produce telemetry for the invocation.
  - `usage` event SHOULD be sent once final usage is known.

### 5) Error normalization
- All invocation failures MUST be mapped to the normalized error envelope described in `10_API_CONTRACTS.md`.
- Provider internals (request ids, stack traces, credentials) MUST NOT be returned to clients.
- `retryable` must be accurate:
  - transient provider failures: true
  - validation/config/session-expired: false

### 6) Telemetry correlation
- The invocation gateway MUST generate a `traceId` if missing and propagate it:
  - to the provider adapter request metadata (headers/metadata where possible),
  - to telemetry events emitted by the data plane or adapter.

### 7) Limits and gating integration
- Limit enforcement is performed in the invocation gateway before provider invocation whenever possible.
- Runtime gating (AgentCore entitlement) MUST be enforced on:
  - deploy path,
  - invoke path,
  - adapter path (defense in depth).

## Acceptance criteria

This ADR is correctly implemented when:

1. **Unified contract**
   - Both Cloudflare and AgentCore invocations accept the same `invoke/v1` request shape at the gateway.

2. **Normalization**
   - `prompt` input is correctly normalized to `messages`.
   - Ambiguous inputs (both prompt and messages) are handled consistently.

3. **Sessions**
   - `sessionId` round-trips correctly for sessionful invocations on both providers (where supported).
   - The system treats session ids as opaque and does not leak provider internals.

4. **Streaming**
   - Streaming endpoint emits SSE events in the required order (`meta` → `delta*` → `usage?` → `done` OR `error`).
   - Non-streaming providers can still be used through streaming endpoint (emulated streaming acceptable).

5. **Telemetry**
   - Each invocation results in a telemetry event with correct attribution and `traceId`.
   - Telemetry cannot be spoofed (signature verification enforced elsewhere per security spec).

6. **Errors**
   - Provider failures are normalized and sanitized; no secrets or raw provider errors leak to clients.

## Follow-ups / future extensions

- Add `invoke/v2` if/when tool calls and structured outputs need to be first-class in the protocol:
  - tool call messages,
  - structured JSON outputs with schemas,
  - partial tool events over the stream.
- Introduce WebSockets only if bidirectional interactive tool sessions become a product requirement.
- Add explicit “async job” protocol for long-running tasks (especially for AgentCore) to avoid HTTP timeouts while preserving correlation and telemetry.