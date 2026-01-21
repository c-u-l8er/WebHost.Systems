# webhost.systems — API Contracts (v1)
Version: 1.0  
Status: Implementation-ready  
Last updated: 2026-01-21  

This document defines the **control plane** and **invocation gateway** API contracts for webhost.systems, including request/response formats, normalized errors, idempotency, pagination, and telemetry ingestion.

> Normative language: MUST, MUST NOT, SHOULD, MAY.

---

## 1) Principles

### 1.1 Control plane vs data plane
- **Control plane APIs** manage users, agents, deployments, billing, and metrics aggregation.
- **Data plane** executes agent code on runtime providers and reports telemetry to the control plane.

### 1.2 Stability rules
- Endpoints and payloads defined here are **public contracts**.
- Additive changes are allowed (adding fields, adding enum values with backward compatibility).
- Breaking changes require a new version (`/v2/...`) and a deprecation plan.

### 1.3 Authentication/authorization
- All control plane endpoints are **authenticated** unless explicitly marked public.
- Authorization is tenant-scoped:
  - The caller can only access resources they own, unless they have an administrative role (not in MVP).
- Invocation can be:
  - authenticated-only (MVP default), OR
  - optionally public via per-agent API key (post-MVP).

### 1.4 Idempotency
- All endpoints that create side effects (create agent, deploy, report metrics) SHOULD accept an `Idempotency-Key` header.
- The server MUST treat retries with the same idempotency key as a single logical operation.

### 1.5 Time
- All timestamps are RFC3339 UTC (`2026-01-21T00:00:00Z`) or unix ms; this spec uses RFC3339 for external APIs.
- Server MAY store timestamps as integers internally.

---

## 2) Common types

### 2.1 IDs
All IDs are opaque strings (e.g., Convex document ids). Clients MUST NOT infer meaning from them.

- `UserId`: string
- `AgentId`: string
- `DeploymentId`: string
- `MetricEventId`: string

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

### 2.6 Trace and correlation
- `traceId`: server-generated string on every request (also accepted if provided).
- All responses SHOULD include `traceId`.
- Data plane telemetry MUST include `traceId` when possible.

---

## 3) Normalized errors (REQUIRED)

### 3.1 Error envelope
All non-2xx responses MUST use:

```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L88-117
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

- `UNAUTHENTICATED` — missing/invalid session
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
- `LIMIT_EXCEEDED` -> 402 (or 403). Use 402 if you want “upgrade to continue” semantics.
- `DEPLOYMENT_FAILED` -> 502 (or 500). Use 502 if the provider is the failure boundary.
- `RUNTIME_ERROR` -> 502
- `INTERNAL` -> 500

### 3.4 Validation errors
For `INVALID_REQUEST`, `details` SHOULD include field-level issues:

```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L146-171
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
- Clients authenticate via your chosen auth provider session (e.g., cookie-based session from Clerk).
- Server derives `userId` from the authenticated identity mapping.
- If no session: return `UNAUTHENTICATED`.

### 4.2 Invocation auth (MVP default)
- Invocation endpoint requires authentication (same as control plane), unless agent is explicitly configured as public (post-MVP).

### 4.3 Telemetry auth (data plane → control plane)
Telemetry ingestion MUST be protected against spoofing.

MVP requirement:
- Each deployment MUST have an associated `telemetrySecret` (HMAC key) that is injected into the runtime provider as a secret (never stored in plaintext in DB).
- Telemetry requests MUST include a signature header:
  - `X-Telemetry-Signature: v1=<hex-hmac-sha256(body)>`
  - `X-Telemetry-Deployment-Id: <deploymentId>`
- Control plane verifies signature using the secret for that deployment.

---

## 5) Resource shapes

### 5.1 User
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L220-238
{
  "id": "usr_...",
  "email": "user@example.com",
  "name": "Jane Developer",
  "subscriptionTier": "pro",
  "defaultRuntimeProvider": "cloudflare",
  "createdAt": "2026-01-01T00:00:00Z"
}
```

### 5.2 Agent
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L243-290
{
  "id": "agt_...",
  "userId": "usr_...",
  "name": "support-bot",
  "description": "Customer support assistant",
  "framework": "vercel-ai-sdk",
  "runtimeProvider": "cloudflare",
  "status": "active",
  "activeDeploymentId": "dep_...",
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
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L295-346
{
  "id": "dep_...",
  "agentId": "agt_...",
  "version": 3,
  "runtimeProvider": "cloudflare",
  "status": "active",
  "commitHash": "a1b2c3d",
  "artifact": {
    "type": "uploaded_bundle",
    "source": {
      "uploadId": "upl_...",
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
  "deployedBy": "usr_..."
}
```

---

## 6) Control plane endpoints (HTTP form)

> If you implement these as Convex queries/mutations/actions instead of HTTP routes, preserve the same payload shapes and error normalization.

### 6.1 Get current user
**GET** `/v1/me`

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L364-374
{
  "user": { /* User */ },
  "traceId": "trc_..."
}
```

Errors: `UNAUTHENTICATED`.

---

## 7) Agents API

### 7.1 Create agent
**POST** `/v1/agents`

Headers:
- `Idempotency-Key: <string>` (recommended)

Request:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L389-404
{
  "name": "support-bot",
  "description": "Customer support assistant",
  "framework": "vercel-ai-sdk",
  "runtimeProvider": "cloudflare",
  "envVarKeys": ["OPENAI_API_KEY"]
}
```

Response 201:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L409-416
{
  "agent": { /* Agent */ },
  "traceId": "trc_..."
}
```

Validation rules (MVP):
- `name` required; 3–64 chars; `[a-zA-Z0-9-_]` recommended.
- `runtimeProvider` required.
- `envVarKeys` MAY be empty; keys MUST be 1–128 chars, uppercase + underscores recommended.

Errors:
- `INVALID_REQUEST`
- `CONFLICT` (if name uniqueness enforced per user)

---

### 7.2 List agents
**GET** `/v1/agents?limit=25&cursor=...`

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L434-441
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
**GET** `/v1/agents/{agentId}`

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L450-456
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
**PATCH** `/v1/agents/{agentId}`

Request (all fields optional; server applies partial update):
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L466-478
{
  "name": "support-bot-v2",
  "description": "New description",
  "framework": "vercel-ai-sdk",
  "runtimeProvider": "cloudflare",
  "envVarKeys": ["OPENAI_API_KEY", "SUPPORT_EMAIL"]
}
```

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L483-489
{
  "agent": { /* Agent */ },
  "traceId": "trc_..."
}
```

Notes:
- Changing `runtimeProvider` SHOULD be allowed only if:
  - the agent has no active deployment OR
  - the client explicitly triggers a new deployment afterwards.
- Server MUST validate entitlement when setting `runtimeProvider=agentcore`.

Errors:
- `INVALID_REQUEST`
- `LIMIT_EXCEEDED` (tier gating for AgentCore)
- `CONFLICT` (e.g., agent currently deploying)
- `NOT_FOUND` / `UNAUTHORIZED`

---

### 7.5 Disable agent
**POST** `/v1/agents/{agentId}/disable`

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L512-518
{
  "agent": { /* Agent status=disabled */ },
  "traceId": "trc_..."
}
```

Errors:
- `NOT_FOUND` / `UNAUTHORIZED`

---

### 7.6 Delete agent
**DELETE** `/v1/agents/{agentId}`

Response 204: no body.

Notes:
- Server SHOULD attempt to deprovision provider resources (best-effort).
- Server MUST delete or tombstone agent and related resources according to retention policies.

Errors:
- `NOT_FOUND` / `UNAUTHORIZED`
- `CONFLICT` if deletion blocked by in-progress deployment (optional)

---

## 8) Deployments API

### 8.1 Create and deploy (single step)
**POST** `/v1/agents/{agentId}/deployments`

Headers:
- `Idempotency-Key: <string>` (recommended)

Request (uploaded bundle path):
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L553-580
{
  "artifact": {
    "type": "uploaded_bundle",
    "uploadId": "upl_..."
  },
  "commitHash": "a1b2c3d",
  "version": 3,
  "setAsActive": true
}
```

Request (repo ref; post-MVP or optional):
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L584-602
{
  "artifact": {
    "type": "repo_ref",
    "githubUrl": "https://github.com/acme/support-bot",
    "ref": "main"
  },
  "commitHash": "a1b2c3d",
  "setAsActive": true
}
```

Response 202 (async deploy started):
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L607-616
{
  "deployment": { /* Deployment status=deploying */ },
  "traceId": "trc_..."
}
```

Notes:
- Deploy is async; client polls deployment status or uses realtime subscription if available.
- Server MUST validate runtime gating (tier) and artifact constraints before creating provider resources.
- For `runtimeProvider=agentcore`, the deployment pipeline MAY involve a server-side build step (for example: building a container/runtime artifact from an uploaded bundle). In that case:
  - secrets MUST be injected into the runtime using provider-supported mechanisms at deploy/update time (not embedded in artifacts), and
  - users SHOULD set required secrets before initiating deployment so the build/deploy can succeed without retries that risk leaking sensitive values.

Errors:
- `INVALID_REQUEST`
- `LIMIT_EXCEEDED` (runtime gated)
- `CONFLICT` (deploy in progress)
- `NOT_FOUND` / `UNAUTHORIZED`

---

### 8.2 List deployments
**GET** `/v1/agents/{agentId}/deployments?limit=25&cursor=...`

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L638-645
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
**GET** `/v1/deployments/{deploymentId}`

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L656-662
{
  "deployment": { /* Deployment */ },
  "traceId": "trc_..."
}
```

Errors:
- `NOT_FOUND` / `UNAUTHORIZED`

---

### 8.4 Rollback (set active deployment)
**POST** `/v1/agents/{agentId}/deployments/{deploymentId}/activate`

Request:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L676-681
{
  "reason": "Rollback after errors"
}
```

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L686-695
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
**GET** `/v1/deployments/{deploymentId}/logs`

Response 200 (MVP shape):
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L712-723
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
**POST** `/v1/agents/{agentId}/secrets`

Request:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L750-761
{
  "secrets": {
    "OPENAI_API_KEY": "sk-...",
    "SUPPORT_EMAIL": "support@acme.com"
  }
}
```

Response 204: no body.

Rules:
- Server MUST NOT return secret values.
- Server MUST store secrets in provider secret store(s) appropriate for the agent runtime, or in a centralized secret manager with provider injection.
- Server MUST redact secrets from logs.

Errors:
- `INVALID_REQUEST`
- `NOT_FOUND` / `UNAUTHORIZED`
- `CONFLICT` if agent is mid-deploy (optional)

---

## 10) Invocation gateway API (canonical)

### 10.1 Invoke agent (non-streaming)
**POST** `/v1/invoke/{agentId}`

Request (`messages` form):
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L790-822
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
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L826-839
{
  "input": { "prompt": "Hello! What can you do?" }
}
```

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L844-872
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
- Route invocation to the active deployment’s runtime provider.
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
**POST** `/v1/invoke/{agentId}/stream`

Accept: `text/event-stream`

Request: same as non-streaming.

Response: SSE events (recommended event types):
- `event: meta` — includes `traceId`, `sessionId`
- `event: delta` — partial text chunks
- `event: usage` — final usage summary
- `event: done` — indicates completion
- `event: error` — normalized error envelope

Example stream:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L915-950
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

## 11) Telemetry ingestion API (data plane → control plane)

### 11.1 Report telemetry event
**POST** `/v1/telemetry/report`

Headers:
- `Content-Type: application/json`
- `X-Telemetry-Deployment-Id: <deploymentId>`
- `X-Telemetry-Signature: v1=<hex-hmac-sha256(body)>`

Request:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L983-1028
{
  "userId": "usr_...",
  "agentId": "agt_...",
  "deploymentId": "dep_...",
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
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L1033-1041
{
  "accepted": true,
  "traceId": "trc_..."
}
```

Server validation (MUST):
- Verify signature and deployment id.
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
**GET** `/v1/billing/usage?period=2026-01` (period optional; defaults to current)

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L1070-1107
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
**GET** `/v1/agents/{agentId}/metrics?from=2026-01-01T00:00:00Z&to=2026-01-21T00:00:00Z&bucket=hour`

Query params:
- `from` (required)
- `to` (required)
- `bucket` (`minute` | `hour` | `day`) (default `hour`)
- `runtimeProvider` optional filter
- `deploymentId` optional filter

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L1140-1184
{
  "agentId": "agt_...",
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
**POST** `/v1/billing/checkout`

Request:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L1212-1218
{
  "tier": "pro"
}
```

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L1223-1230
{
  "checkoutUrl": "https://...",
  "traceId": "trc_..."
}
```

Errors:
- `INVALID_REQUEST`
- `UNAUTHENTICATED`

### 13.2 Billing webhooks (server-only)
**POST** `/v1/billing/webhook`

Notes:
- This endpoint MUST verify the billing provider signature.
- It is not called by browsers.
- It updates entitlements and subscription state.

Response 200:
```WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md#L1244-1249
{
  "ok": true
}
```

Errors:
- `UNAUTHENTICATED` (signature invalid)

---

## 14) State machines (normative)

### 14.1 Agent state
- `created` → `deploying` (when deployment starts)
- `deploying` → `active` (deployment succeeds and becomes active)
- `deploying` → `error` (deployment fails)
- any → `disabled` (manual disable)
- `disabled` → `active` (manual enable; optional endpoint)

### 14.2 Deployment state
- `deploying` → `active` (success)
- `deploying` → `failed` (failure)
- `active` → `rolled_back` (when superseded by rollback/activation of different deployment; optional bookkeeping)

---

## 15) Security & privacy requirements for API responses
- Responses MUST NOT include secret values.
- Error messages MUST be sanitized (no provider credentials, no stack traces).
- `details` MAY include internal error ids; never include raw provider error dumps unless explicitly whitelisted and sanitized.

---

## 16) Compatibility notes (implementation)
- If implemented in Convex:
  - Treat each route above as a function with equivalent input/output.
  - Ensure normalized error envelope is produced consistently.
- If implemented in Next.js API routes:
  - Use middleware for auth, traceId, and error normalization.

---