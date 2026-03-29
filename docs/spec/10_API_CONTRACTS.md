# webhost.systems — API Contracts (v1)
Version: 1.1
Status: Implementation-ready
Last updated: 2026-03-28

This document defines the **control plane** and **invocation gateway** API contracts for webhost.systems, including request/response formats, normalized errors, idempotency, pagination, and telemetry ingestion.

> Normative language: MUST, MUST NOT, SHOULD, MAY.

---

## 1) Principles

### 1.1 Control plane vs data plane
- **Control plane APIs** manage users, agents, deployments, billing, and metrics aggregation.
- **Data plane** executes agent code on runtime providers and reports telemetry to the control plane.

### 1.2 Implementation model
Control plane APIs are implemented via:
- **PostgREST** (auto-generated REST from PostgreSQL schema) for simple CRUD with RLS enforcement.
- **Supabase RPC functions** (PostgreSQL functions exposed via PostgREST) for business logic that needs transactional guarantees.
- **Supabase Edge Functions** (Deno-based server functions) for server-only operations: deployment orchestration, invocation gateway, telemetry ingestion, billing webhooks.

### 1.3 Stability rules
- Endpoints and payloads defined here are **public contracts**.
- Additive changes are allowed (adding fields, adding enum values with backward compatibility).
- Breaking changes require a new version (`/v2/...`) and a deprecation plan.

### 1.4 Authentication/authorization
- All control plane endpoints are **authenticated** unless explicitly marked public.
- Authentication uses **Supabase Auth JWTs** passed as `Authorization: Bearer <token>`.
- Authorization is tenant-scoped via **RLS policies**:
  - The caller can only access resources they own, unless they have an administrative role (not in MVP).
- Invocation can be:
  - authenticated-only (MVP default), OR
  - optionally public via per-agent API key (post-MVP).

### 1.5 Idempotency
- All endpoints that create side effects (create agent, deploy, report metrics) SHOULD accept an `Idempotency-Key` header.
- The server MUST treat retries with the same idempotency key as a single logical operation.

### 1.6 Time
- All timestamps are RFC3339 UTC (`2026-01-21T00:00:00Z`) or unix ms; this spec uses RFC3339 for external APIs.
- Server MAY store timestamps as `timestamptz` or integers internally.

---

## 2) Common types

### 2.1 IDs
All IDs are UUIDs. Clients MUST NOT infer meaning from them.

- `UserId`: UUID string
- `AgentId`: UUID string
- `DeploymentId`: UUID string
- `MetricEventId`: UUID string

### 2.2 Runtime providers
`RuntimeProvider` enum:

- `cloudflare`
- `agentcore`

### 2.3 Agent status
`AgentStatus` enum:

- `created`
- `deploying`
- `active`
- `error`
- `disabled`

### 2.4 Deployment status
`DeploymentStatus` enum:

- `deploying`
- `active`
- `failed`
- `rolled_back`

### 2.5 Pagination
For list endpoints, use cursor pagination:

Request query params:
- `limit` (integer, default 25, max 100)
- `cursor` (string, optional)

Response fields:
- `items`: array
- `nextCursor`: string | null

Note: PostgREST endpoints may alternatively use `Range` headers or `offset`/`limit` query params. RPC functions and Edge Functions SHOULD use cursor pagination.

### 2.6 Trace and correlation
- `traceId`: server-generated string on every request (also accepted if provided).
- All responses SHOULD include `traceId`.
- Data plane telemetry MUST include `traceId` when possible.

---

## 3) Normalized errors (REQUIRED)

### 3.1 Error envelope
All non-2xx responses MUST use:

```json
{
  "error": {
    "code": "LIMIT_EXCEEDED",
    "message": "Monthly request limit exceeded for your current plan.",
    "details": {
      "limitType": "requests",
      "period": "2026-01",
      "current": 10001,
      "limit": 10000
    },
    "retryable": false
  },
  "traceId": "trc_01J3..."
}
```

### 3.2 Error codes
`ErrorCode` enum (MVP set; extensible):

- `UNAUTHENTICATED` — missing/invalid session or JWT
- `UNAUTHORIZED` — authenticated but not allowed (tenant boundary)
- `NOT_FOUND` — resource does not exist or not visible
- `INVALID_REQUEST` — validation failure (schema, required fields, etc.)
- `CONFLICT` — resource state conflict (e.g., deploy while already deploying)
- `RATE_LIMITED` — request rate exceeded (may be added later)
- `LIMIT_EXCEEDED` — plan/usage limit exceeded
- `DEPLOYMENT_FAILED` — deployment failed (includes provider message sanitized)
- `RUNTIME_ERROR` — runtime invocation failure (provider/runtime/tool error)
- `INTERNAL` — unexpected server failure

### 3.3 HTTP mapping (recommended)
- `UNAUTHENTICATED` -> 401
- `UNAUTHORIZED` -> 403
- `NOT_FOUND` -> 404
- `INVALID_REQUEST` -> 400
- `CONFLICT` -> 409
- `RATE_LIMITED` -> 429
- `LIMIT_EXCEEDED` -> 402 (or 403). Use 402 if you want "upgrade to continue" semantics.
- `DEPLOYMENT_FAILED` -> 502 (or 500). Use 502 if the provider is the failure boundary.
- `RUNTIME_ERROR` -> 502
- `INTERNAL` -> 500

### 3.4 Validation errors
For `INVALID_REQUEST`, `details` SHOULD include field-level issues:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Validation failed.",
    "details": {
      "issues": [
        { "path": ["name"], "message": "Name is required." },
        { "path": ["runtimeProvider"], "message": "Must be one of: cloudflare, agentcore." }
      ]
    },
    "retryable": false
  },
  "traceId": "trc_..."
}
```

---

## 4) Authentication

### 4.1 Control plane auth
- Clients authenticate via Supabase Auth (JWT-based).
- The frontend obtains JWTs via Supabase client SDK (`supabase.auth.getSession()`).
- All API requests include `Authorization: Bearer <access_token>`.
- Server derives `userId` from `auth.uid()` (the JWT subject claim).
- If no valid JWT: return `UNAUTHENTICATED`.

### 4.2 Invocation auth (MVP default)
- Invocation endpoint requires authentication (same as control plane), unless agent is explicitly configured as public (post-MVP).

### 4.3 Telemetry auth (data plane -> control plane)
Telemetry ingestion MUST be protected against spoofing.

MVP requirement:
- Each deployment MUST have an associated `telemetrySecret` (HMAC key) that is injected into the runtime provider as a secret.
- The control plane database stores the `telemetrySecret` in **Supabase Vault** (encrypted at rest). The plaintext value MUST NOT be stored in regular PostgreSQL tables.
- Telemetry requests MUST include a signature header:
  - `X-Telemetry-Signature: v1=<hex-hmac-sha256(body)>`
  - `X-Telemetry-Deployment-Id: <deploymentId>`
- Control plane (Edge Function) verifies signatures by retrieving the secret from Supabase Vault.
- Rotation:
  - Rotating `telemetrySecret` MUST be supported by updating the Vault entry and the provider secret (and must be auditable).
  - If you need zero-downtime rotation, support a short overlap window where both "current" and "previous" secrets are accepted for verification.
- Anti-replay (recommended, non-breaking):
  - Include a timestamp header (e.g., `X-Telemetry-Timestamp`) and reject signatures outside a small window, or include a nonce/eventId with dedupe at ingestion.

### 4.4 Delegated invocation auth (server-to-server; internal)
WHS MAY support a **delegated invocation** auth mode for trusted backend callers (e.g., a workflow orchestrator) to invoke an agent **on behalf of** an end user **without forwarding browser JWTs**.

If enabled, delegated invocation MUST:
- authenticate the delegator using **HMAC over raw request bytes** (signature header + timestamp window),
- include a delegated end-user identity in the request body (e.g., `delegation.externalUserId`),
- enforce WHS authorization, limits, and billing **as the delegated user** (no bypass),
- require an idempotency key and dedupe by `(delegated user, agentId, idempotencyKey)` to prevent duplicate cost/side effects under retries.

This auth mode is **service authentication** for the delegator, not user authentication. It MUST NOT weaken tenant isolation.

---

## 5) Resource shapes

### 5.1 User
```json
{
  "id": "uuid-...",
  "email": "user@example.com",
  "name": "Jane Developer",
  "subscriptionTier": "pro",
  "defaultRuntimeProvider": "cloudflare",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

### 5.2 Agent
```json
{
  "id": "uuid-...",
  "userId": "uuid-...",
  "name": "support-bot",
  "description": "Customer support assistant",
  "framework": "vercel-ai-sdk",
  "runtimeProvider": "cloudflare",
  "status": "active",
  "activeDeploymentId": "uuid-...",
  "envVarKeys": ["OPENAI_API_KEY", "SUPPORT_EMAIL"],
  "providerConfig": {
    "cloudflare": {
      "workerName": "agent-support-bot",
      "workerUrl": "https://support-bot.example.workers.dev",
      "durableObjectNamespace": "AGENT_DO",
      "durableObjectId": "do_..."
    },
    "agentcore": null
  },
  "createdAt": "2026-01-10T00:00:00Z",
  "lastDeployedAt": "2026-01-20T00:00:00Z"
}
```

Notes:
- `providerConfig.cloudflare` and `providerConfig.agentcore` are mutually exclusive based on `runtimeProvider`.
- Server MAY return both blocks but MUST set the non-applicable one to `null`.

### 5.3 Deployment
```json
{
  "id": "uuid-...",
  "agentId": "uuid-...",
  "version": 3,
  "runtimeProvider": "cloudflare",
  "status": "active",
  "commitHash": "a1b2c3d",
  "artifact": {
    "type": "uploaded_bundle",
    "source": {
      "uploadId": "uuid-...",
      "checksum": "sha256:...",
      "sizeBytes": 123456
    }
  },
  "providerRef": {
    "cloudflare": {
      "workerUrl": "https://support-bot.example.workers.dev",
      "durableObjectId": "do_..."
    },
    "agentcore": null
  },
  "errorMessage": null,
  "deployedAt": "2026-01-20T00:00:00Z",
  "deployedBy": "uuid-..."
}
```

---

## 6) Control plane endpoints (HTTP form)

> CRUD operations use PostgREST (auto-generated REST with RLS) or Supabase RPC functions. Server-only operations use Edge Functions. Both produce the same payload shapes and error normalization.

### 6.1 Get current user
**GET** `/rest/v1/rpc/get_current_user`

Response 200:
```json
{
  "user": { /* User */ },
  "traceId": "trc_..."
}
```

Errors: `UNAUTHENTICATED`.

---

## 7) Agents API

### 7.1 Create agent
**POST** `/rest/v1/rpc/create_agent`

Headers:
- `Authorization: Bearer <token>`
- `Idempotency-Key: <string>` (recommended)

Request:
```json
{
  "name": "support-bot",
  "description": "Customer support assistant",
  "framework": "vercel-ai-sdk",
  "runtime_provider": "cloudflare",
  "env_var_keys": ["OPENAI_API_KEY"]
}
```

Response 201:
```json
{
  "agent": { /* Agent */ },
  "traceId": "trc_..."
}
```

Validation rules (MVP):
- `name` required; 3-64 chars; `[a-zA-Z0-9-_]` recommended.
- `runtime_provider` required.
- `env_var_keys` MAY be empty; keys MUST be 1-128 chars, uppercase + underscores recommended.

Errors:
- `INVALID_REQUEST`
- `CONFLICT` (if name uniqueness enforced per user)

---

### 7.2 List agents
**GET** `/rest/v1/agents?select=*&order=created_at.desc&limit=25`

RLS automatically filters to current user's agents.

Response 200:
```json
{
  "items": [{ /* Agent */ }],
  "nextCursor": null,
  "traceId": "trc_..."
}
```

Errors:
- `UNAUTHENTICATED`

---

### 7.3 Get agent
**GET** `/rest/v1/agents?id=eq.<agentId>&select=*`

Response 200:
```json
{
  "agent": { /* Agent */ },
  "traceId": "trc_..."
}
```

Errors:
- `NOT_FOUND`
- `UNAUTHORIZED`

---

### 7.4 Update agent
**POST** `/rest/v1/rpc/update_agent`

Request (all fields optional; server applies partial update):
```json
{
  "agent_id": "uuid-...",
  "name": "support-bot-v2",
  "description": "New description",
  "framework": "vercel-ai-sdk",
  "runtime_provider": "cloudflare",
  "env_var_keys": ["OPENAI_API_KEY", "SUPPORT_EMAIL"]
}
```

Response 200:
```json
{
  "agent": { /* Agent */ },
  "traceId": "trc_..."
}
```

Notes:
- Changing `runtime_provider` SHOULD be allowed only if:
  - the agent has no active deployment OR
  - the client explicitly triggers a new deployment afterwards.
- Server MUST validate entitlement when setting `runtime_provider=agentcore`.

Errors:
- `INVALID_REQUEST`
- `LIMIT_EXCEEDED` (tier gating for AgentCore)
- `CONFLICT` (e.g., agent currently deploying)
- `NOT_FOUND` / `UNAUTHORIZED`

---

### 7.5 Disable agent
**POST** `/rest/v1/rpc/disable_agent`

Request: `{ "agent_id": "uuid-..." }`

Response 200:
```json
{
  "agent": { /* Agent status=disabled */ },
  "traceId": "trc_..."
}
```

Errors:
- `NOT_FOUND` / `UNAUTHORIZED`

---

### 7.6 Delete agent
**POST** `/rest/v1/rpc/delete_agent`

Request: `{ "agent_id": "uuid-..." }`

Response 204: no body.

Notes:
- Server SHOULD attempt to deprovision provider resources (best-effort).
- Server MUST soft-delete (set `deleted_at`) and related resources according to retention policies.

Errors:
- `NOT_FOUND` / `UNAUTHORIZED`
- `CONFLICT` if deletion blocked by in-progress deployment (optional)

---

## 8) Deployments API

### 8.1 Create and deploy (single step)
**POST** `/functions/v1/deploy`

This is an **Edge Function** because it performs server-only provider API calls.

Headers:
- `Authorization: Bearer <token>`
- `Idempotency-Key: <string>` (recommended)

Request (uploaded bundle path):
```json
{
  "agentId": "uuid-...",
  "artifact": {
    "type": "uploaded_bundle",
    "uploadId": "uuid-..."
  },
  "commitHash": "a1b2c3d",
  "version": 3,
  "setAsActive": true
}
```

Response 202 (async deploy started):
```json
{
  "deployment": { /* Deployment status=deploying */ },
  "traceId": "trc_..."
}
```

Notes:
- Deploy is async; client polls deployment status or uses Supabase Realtime subscription for live updates.
- Server MUST validate runtime gating (tier) and artifact constraints before creating provider resources.

Errors:
- `INVALID_REQUEST`
- `LIMIT_EXCEEDED` (runtime gated)
- `CONFLICT` (deploy in progress)
- `NOT_FOUND` / `UNAUTHORIZED`

---

### 8.2 List deployments
**GET** `/rest/v1/deployments?agent_id=eq.<agentId>&order=created_at.desc&limit=25`

RLS automatically filters to current user's deployments.

Response 200:
```json
{
  "items": [{ /* Deployment */ }],
  "nextCursor": null,
  "traceId": "trc_..."
}
```

Errors:
- `NOT_FOUND` / `UNAUTHORIZED`

---

### 8.3 Get deployment
**GET** `/rest/v1/deployments?id=eq.<deploymentId>&select=*`

Response 200:
```json
{
  "deployment": { /* Deployment */ },
  "traceId": "trc_..."
}
```

Errors:
- `NOT_FOUND` / `UNAUTHORIZED`

---

### 8.4 Rollback (set active deployment)
**POST** `/functions/v1/activate-deployment`

This is an **Edge Function** because it may coordinate with provider APIs.

Request:
```json
{
  "agentId": "uuid-...",
  "deploymentId": "uuid-...",
  "reason": "Rollback after errors"
}
```

Response 200:
```json
{
  "agent": { /* Agent with activeDeploymentId updated */ },
  "deployment": { /* Deployment status active */ },
  "traceId": "trc_..."
}
```

Errors:
- `NOT_FOUND` / `UNAUTHORIZED`
- `CONFLICT` (deployment not in a valid state to activate)

---

### 8.5 Get deployment logs (MVP minimal)
**POST** `/rest/v1/rpc/get_deployment_logs`

Request: `{ "deployment_id": "uuid-..." }`

Response 200 (MVP shape):
```json
{
  "lines": [
    { "timestamp": "2026-01-21T00:00:00Z", "level": "info", "message": "Deploy started" },
    { "timestamp": "2026-01-21T00:00:05Z", "level": "error", "message": "Build failed: missing agent.config.json" }
  ],
  "nextCursor": null,
  "traceId": "trc_..."
}
```

Errors:
- `NOT_FOUND` / `UNAUTHORIZED`

---

## 9) Secrets & configuration API (recommended)

### 9.1 Set agent env secrets (write-only)
**POST** `/functions/v1/set-secrets`

This is an **Edge Function** because it writes to Supabase Vault and provider secret stores.

Request:
```json
{
  "agentId": "uuid-...",
  "secrets": {
    "OPENAI_API_KEY": "sk-...",
    "SUPPORT_EMAIL": "support@acme.com"
  }
}
```

Response 204: no body.

Rules:
- Server MUST NOT return secret values.
- Server MUST store secrets in Supabase Vault (encrypted) and inject into provider secret store(s) at deploy time.
- Server MUST redact secrets from logs.

Errors:
- `INVALID_REQUEST`
- `NOT_FOUND` / `UNAUTHORIZED`
- `CONFLICT` if agent is mid-deploy (optional)

---

## 10) Invocation gateway API (canonical)

### 10.1 Invoke agent (non-streaming)
**POST** `/functions/v1/invoke/<agentId>`

This is an **Edge Function** that authenticates, checks limits, and routes to the provider.

Request (`messages` form):
```json
{
  "input": {
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Summarize last week's support tickets." }
    ]
  },
  "sessionId": null,
  "options": {
    "maxSteps": 10,
    "temperature": 0.2
  },
  "metadata": {
    "traceId": "trc_client_...",
    "client": { "name": "web", "version": "1.0.0" }
  }
}
```

Request (`prompt` convenience form; server converts to messages):
```json
{
  "input": { "prompt": "Hello! What can you do?" }
}
```

Response 200:
```json
{
  "output": {
    "text": "I can help you deploy and run AI agents..."
  },
  "sessionId": "sess_opaque_...",
  "usage": {
    "tokens": 123,
    "computeMs": 456,
    "toolCalls": 0
  },
  "traceId": "trc_01J3..."
}
```

Server behavior (MUST):
- Resolve agent ownership (unless public invocation enabled).
- Ensure agent is not disabled.
- Ensure agent has an active deployment.
- Enforce plan limits before routing to runtime provider.
- Route invocation to the active deployment's runtime provider.
- Generate `traceId` if missing.
- Normalize provider errors into the error envelope.

Errors:
- `UNAUTHENTICATED` / `UNAUTHORIZED` (MVP default)
- `NOT_FOUND`
- `LIMIT_EXCEEDED`
- `RUNTIME_ERROR`
- `INVALID_REQUEST`

---

### 10.2 Invoke agent (streaming; SSE)
**POST** `/functions/v1/invoke/<agentId>/stream`

Accept: `text/event-stream`

Request: same as non-streaming.

Response: SSE events (recommended event types):
- `event: meta` — includes `traceId`, `sessionId`
- `event: delta` — partial text chunks
- `event: usage` — final usage summary
- `event: done` — indicates completion
- `event: error` — normalized error envelope

Example stream:
```
event: meta
data: {"traceId":"trc_01J3...","sessionId":"sess_opaque_..."}

event: delta
data: {"text":"I can help you "}

event: delta
data: {"text":"deploy and run AI agents."}

event: usage
data: {"tokens":123,"computeMs":456,"toolCalls":0}

event: done
data: {}
```

Notes:
- Streaming is optional per runtime provider; if unsupported, server MAY emulate streaming by chunking buffered output.

---

### 10.3 Invoke agent (delegated; server-to-server, internal)
**POST** `/functions/v1/delegated/invoke/<agentId>`
**Purpose:** Allow trusted backend systems (e.g., workflow runners) to invoke an agent on behalf of a delegated end user without forwarding browser JWTs.

This endpoint is **internal** and MUST NOT be used by browsers.

#### Authentication (REQUIRED)
Request MUST include:
- `X-WHS-Delegation-Source: <string>` (e.g., `agentromatic`)
- `X-WHS-Delegation-Timestamp: <epoch_ms>`
- `X-WHS-Delegation-Signature: v1=<hex-hmac-sha256(raw_body_bytes)>`

Server behavior (MUST):
- Verify HMAC signature over the exact raw request bytes using `WHS_DELEGATION_SECRET`.
- Validate timestamp within an allowed skew window (recommended +/-5 minutes).
- Optionally enforce a source allowlist (`X-WHS-Delegation-Source`) (recommended).
- Reject invalid signatures/timestamps with `UNAUTHENTICATED`.

#### Request body (REQUIRED)
The request body MUST include:
- a delegation envelope (delegated identity + idempotency),
- the normal invocation request shape under `invoke` (compatible with `InvokeRequest`).

Example:
```json
{
  "delegation": {
    "mode": "hmac_v1",
    "externalUserId": "uuid-...",
    "idempotencyKey": "agentromatic:exec:ex_...:node:node_...:attempt:1",
    "correlation": {
      "workflowId": "wf_...",
      "executionId": "ex_...",
      "nodeId": "node_...",
      "attempt": 1
    }
  },
  "invoke": {
    "input": {
      "messages": [
        { "role": "system", "content": "You are a helpful assistant." },
        { "role": "user", "content": "Summarize last week's support tickets." }
      ]
    },
    "sessionId": null,
    "options": {
      "maxSteps": 10,
      "temperature": 0.2
    },
    "metadata": {
      "traceId": "trc_client_...",
      "client": { "name": "agentromatic", "version": "0.1" }
    }
  }
}
```

Rules:
- `delegation.externalUserId` MUST be the Supabase Auth user ID (UUID) for the end user.
- `delegation.idempotencyKey` is REQUIRED and MUST be:
  - deterministic for a single logical invocation,
  - secret-free,
  - bounded in length.
- The request body MUST NOT include plaintext secrets or end-user auth tokens.

#### Response
On success, response MUST match the canonical invocation response (same as non-streaming invoke), including `traceId`.

#### Authorization & billing (MUST)
Server MUST:
- resolve the delegated user (`externalUserId` -> WHS user row),
- enforce agent visibility/ownership **as that user**,
- enforce plan limits and runtime gating **as that user**,
- route to the active deployment (or a specified deployment if WHS later supports it).

#### Idempotency (MUST)
Server MUST dedupe requests by `(delegation.externalUserId, agentId, delegation.idempotencyKey)`:
- repeated requests with the same tuple MUST NOT double-run or double-charge,
- reusing the same idempotency key with a different payload MUST return `CONFLICT`.

Errors:
- `UNAUTHENTICATED` (bad signature, stale timestamp, unknown source)
- `UNAUTHORIZED` / `NOT_FOUND` (agent not visible to delegated user)
- `LIMIT_EXCEEDED`
- `RUNTIME_ERROR`
- `INVALID_REQUEST`
- `CONFLICT` (idempotency key reuse with different payload)

---

## 11) Telemetry ingestion API (data plane -> control plane)

### 11.1 Report telemetry event
**POST** `/functions/v1/telemetry/report`

This is an **Edge Function** that validates signatures and persists events.

Headers:
- `Content-Type: application/json`
- `X-Telemetry-Deployment-Id: <deploymentId>`
- `X-Telemetry-Signature: v1=<hex-hmac-sha256(body)>`

Request:
```json
{
  "userId": "uuid-...",
  "agentId": "uuid-...",
  "deploymentId": "uuid-...",
  "runtimeProvider": "cloudflare",
  "timestamp": "2026-01-21T00:00:00Z",
  "requests": 1,
  "llmTokens": 123,
  "computeMs": 456,
  "errors": 0,
  "errorClass": null,
  "provider": {
    "cloudflare": {
      "durableObjectOps": 3,
      "workersAICalls": 1
    },
    "agentcore": null
  },
  "costUsd": 0.00123,
  "traceId": "trc_01J3..."
}
```

Response 202:
```json
{
  "accepted": true,
  "traceId": "trc_..."
}
```

Server validation (MUST):
- Verify signature against telemetry secret retrieved from Supabase Vault.
- Ensure `(userId, agentId, deploymentId)` are consistent and owned by the same user.
- Reject events with missing required attribution or invalid enums.

Errors:
- `UNAUTHENTICATED` (bad signature)
- `INVALID_REQUEST`
- `UNAUTHORIZED` (attribution mismatch)
- `NOT_FOUND` (deployment does not exist)

---

## 12) Metrics & usage APIs

### 12.1 Get usage for current billing period
**POST** `/rest/v1/rpc/get_billing_usage`

Request: `{ "period": "2026-01" }` (period optional; defaults to current)

Response 200:
```json
{
  "period": "2026-01",
  "tier": "pro",
  "limits": {
    "requests": 100000,
    "tokens": 5000000,
    "computeMs": 300000000,
    "agentcoreEnabled": true
  },
  "totals": {
    "requests": 1200,
    "tokens": 340000,
    "computeMs": 1200000,
    "costUsdEstimated": 12.34
  },
  "byRuntime": {
    "cloudflare": { "requests": 1100, "tokens": 300000, "costUsdEstimated": 3.21 },
    "agentcore": { "requests": 100, "tokens": 40000, "costUsdEstimated": 9.13 }
  },
  "traceId": "trc_..."
}
```

Errors:
- `UNAUTHENTICATED`

---

### 12.2 Query metrics time series (per agent)
**POST** `/rest/v1/rpc/get_agent_metrics`

Request:
```json
{
  "agent_id": "uuid-...",
  "from_ts": "2026-01-01T00:00:00Z",
  "to_ts": "2026-01-21T00:00:00Z",
  "bucket": "hour"
}
```

Response 200:
```json
{
  "agentId": "uuid-...",
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-01-21T00:00:00Z",
  "bucket": "hour",
  "series": [
    {
      "start": "2026-01-20T10:00:00Z",
      "end": "2026-01-20T11:00:00Z",
      "requests": 120,
      "tokens": 34000,
      "computeMs": 560000,
      "errors": 1,
      "costUsdEstimated": 0.42
    }
  ],
  "traceId": "trc_..."
}
```

Errors:
- `NOT_FOUND` / `UNAUTHORIZED`

---

## 13) Billing APIs (LemonSqueezy-style)

### 13.1 Create checkout
**POST** `/functions/v1/billing/checkout`

This is an **Edge Function** because it calls the billing provider API.

Request:
```json
{
  "tier": "pro"
}
```

Response 200:
```json
{
  "checkoutUrl": "https://...",
  "traceId": "trc_..."
}
```

Errors:
- `INVALID_REQUEST`
- `UNAUTHENTICATED`

### 13.2 Billing webhooks (server-only)
**POST** `/functions/v1/billing/webhook`

Notes:
- This Edge Function MUST verify the billing provider signature.
- It is not called by browsers.
- It updates entitlements and subscription state in PostgreSQL.

Response 200:
```json
{
  "ok": true
}
```

Errors:
- `UNAUTHENTICATED` (signature invalid)

---

## 14) State machines (normative)

### 14.1 Agent state
- `created` -> `deploying` (when deployment starts)
- `deploying` -> `active` (deployment succeeds and becomes active)
- `deploying` -> `error` (deployment fails)
- any -> `disabled` (manual disable)
- `disabled` -> `active` (manual enable; optional endpoint)

### 14.2 Deployment state
- `deploying` -> `active` (success)
- `deploying` -> `failed` (failure)
- `active` -> `rolled_back` (when superseded by rollback/activation of different deployment; optional bookkeeping)

---

## 15) Security & privacy requirements for API responses
- Responses MUST NOT include secret values.
- Error messages MUST be sanitized (no provider credentials, no stack traces).
- `details` MAY include internal error ids; never include raw provider error dumps unless explicitly whitelisted and sanitized.

---

## 16) Compatibility notes (implementation)
- PostgREST endpoints automatically enforce RLS policies for tenant isolation.
- RPC functions (PostgreSQL functions) MUST use `auth.uid()` for authorization.
- Edge Functions MUST validate Supabase Auth JWTs and use the Supabase client with service role only for server-side operations (never expose the service role key to clients).
- Use middleware patterns in Edge Functions for auth, traceId, and error normalization.

---
