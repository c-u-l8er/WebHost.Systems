# 03 — Invocation Gateway

> **Purpose:** How agent invocations flow through the Edge Function gateway,
> including the canonical request/response shapes, authentication, limit checks,
> session handling, streaming, and error normalization.

---

## Gateway Overview

The invocation gateway is a Supabase Edge Function at
`/functions/v1/invoke/:agentId`. It authenticates the caller, checks plan
limits, resolves the active deployment, routes to the runtime provider adapter,
and returns a normalized response.

---

## Request Shape (`InvokeRequest`)

```typescript
interface InvokeRequest {
  input: {
    messages?: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content: string;
    }>;
    prompt?: string;  // converted to messages if provided
  };
  sessionId?: string;  // opaque; provider-specific
  options?: {
    maxSteps?: number;
    temperature?: number;
    toolPolicy?: { allow?: string[]; deny?: string[] };
  };
  metadata?: {
    traceId?: string;
    client?: string;
  };
}
```

**Rule:** If `prompt` is provided instead of `messages`, the gateway converts it
to `[{ role: "user", content: prompt }]` before forwarding.

---

## Response Shape (`InvokeResponse`)

```typescript
interface InvokeResponse {
  output: {
    text: string;
    messages?: Array<{ role: string; content: string }>;
  };
  sessionId?: string;
  usage: {
    tokens?: number;
    computeMs?: number;
    toolCalls?: number;
  };
  traceId: string;
  error?: NormalizedError;
}
```

---

## Gateway Pipeline

```
1. Parse request
2. Authenticate (Supabase Auth JWT)
3. Load agent record (RLS-filtered)
4. Verify agent.status === "active"
5. Resolve active deployment + runtime provider
6. Check plan limits (billing_usage vs tier limits)
7. Generate traceId (if not provided)
8. Route to RPI adapter: invoke(input, sessionId, options)
9. Normalize response
10. Return to caller
```

---

## Authentication

All invocations require a valid Supabase Auth JWT in the `Authorization` header:

```
Authorization: Bearer <supabase-jwt>
```

The gateway extracts `auth.uid()` and uses it to load the agent via RLS. If the
agent does not belong to the caller, the query returns empty and the gateway
returns `NOT_FOUND`.

Post-MVP: per-agent API keys for public invocation.

---

## Limit Checks

Before routing to the provider, the gateway checks:

```sql
SELECT total_requests, total_tokens, total_compute_ms
FROM billing_usage
WHERE user_id = auth.uid()
  AND period_key = current_period();
```

If any metric exceeds the user's tier limit, the gateway returns
`LIMIT_EXCEEDED` without invoking the agent.

---

## Session Handling

- If `sessionId` is provided, it is forwarded to the provider as-is.
- If absent, the provider may create a new session and return the `sessionId`.
- The gateway treats `sessionId` as **opaque** -- never parses or validates it.
- Session semantics are provider-specific (DO instance for Cloudflare, runtime
  session for AgentCore).

---

## Streaming

When the provider supports streaming, the gateway uses Server-Sent Events (SSE):

```
Content-Type: text/event-stream

data: {"type":"chunk","text":"Hello"}
data: {"type":"chunk","text":" world"}
data: {"type":"done","usage":{"tokens":12,"computeMs":340}}
```

When a provider does not support true streaming, the gateway MAY emulate it by
returning the full response as a single chunk followed by `done`.

---

## Error Normalization

All errors are mapped to a standard code set:

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `UNAUTHENTICATED` | 401 | Missing or invalid JWT |
| `UNAUTHORIZED` | 403 | Valid JWT but no access to this agent |
| `NOT_FOUND` | 404 | Agent does not exist (or not owned by caller) |
| `LIMIT_EXCEEDED` | 429 | Plan limit reached for this period |
| `DEPLOYMENT_FAILED` | 502 | No active deployment or deployment is broken |
| `RUNTIME_ERROR` | 502 | Provider returned an error during execution |
| `INVALID_REQUEST` | 400 | Malformed input or missing required fields |

```json
{
  "error": {
    "code": "LIMIT_EXCEEDED",
    "message": "Monthly request limit reached. Upgrade your plan.",
    "traceId": "tr_abc123"
  }
}
```

**Rule:** Error messages must be safe for display. Never include secrets or
internal stack traces.

---

## Rate Limiting

The gateway SHOULD enforce per-user and per-agent rate limits beyond plan
quotas:

- Per-user: max N requests/second across all agents
- Per-agent: max M requests/second per agent
- Payload size: max 1 MB request body

---

## Checklist

- [ ] Every invocation is authenticated via Supabase Auth JWT
- [ ] Agent status is verified as `active` before routing
- [ ] Plan limits are checked before invoking the provider
- [ ] `traceId` is generated or forwarded on every request
- [ ] Errors are normalized to the standard code set
- [ ] Error messages never contain secrets or internal details
- [ ] `sessionId` is treated as opaque
- [ ] Streaming uses SSE format when supported
- [ ] Request payload size is validated
