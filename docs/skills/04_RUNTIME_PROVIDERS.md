# 04 — Runtime Providers

> **Purpose:** How the Runtime Provider Interface (RPI) abstracts execution
> across Cloudflare Workers/DO and AWS Bedrock AgentCore. Covers the adapter
> contracts for deploy, invoke, and healthcheck, plus session mapping and
> secrets injection.

---

## RPI Overview

The **Runtime Provider Interface** is the abstraction boundary between the
control plane and data plane. Every provider adapter implements the same
contract so the control plane can deploy, invoke, and monitor agents
identically regardless of where they execute.

---

## Required Adapter Methods

| Method | Signature | Purpose |
|--------|-----------|---------|
| `deploy` | `(input: DeployInput) -> DeployOutput` | Deploy code to provider |
| `invoke` | `(input: InvokeInput) -> InvokeOutput` | Execute agent (optionally streaming) |
| `healthcheck` | `() -> HealthStatus` | Check provider availability |
| `estimateCost` | `(usage: UsageMetrics) -> number` | Estimate cost in USD |

---

## Deploy Contract

### Input

```typescript
interface DeployInput {
  agentId: string;
  userId: string;
  deploymentId: string;
  version: number;
  artifact: ArtifactRef;       // uploaded_bundle or agentcore_container
  envConfig: Record<string, string>;  // non-secret config
  secretKeys: string[];        // values already in provider secret store
}
```

### Output

```typescript
interface DeployOutput {
  providerRef: Record<string, unknown>;  // sufficient to invoke
  sessionConfig?: Record<string, unknown>;
  status: "success" | "failed";
  error?: NormalizedError;
}
```

---

## Invoke Contract

### Input

```typescript
interface InvokeInput {
  deploymentRef: Record<string, unknown>;  // from DeployOutput.providerRef
  input: { messages: Message[] };
  sessionId?: string;
  options?: InvokeOptions;
  traceId: string;
}
```

### Output

```typescript
interface InvokeOutput {
  output: { text: string; messages?: Message[] };
  sessionId?: string;
  usage: { tokens?: number; computeMs?: number; toolCalls?: number };
  traceId: string;
  error?: NormalizedError;
}
```

**Rule:** Adapters must enforce internal timeouts. Never block indefinitely.

---

## Cloudflare Workers/DO Adapter

### Execution Model

- Worker receives invocation and routes to a Durable Object for stateful sessions.
- DO stores conversation history and session state.
- Worker/DO calls the model provider (BYOK credentials).

### Session Mapping

| Scenario | Behavior |
|----------|----------|
| `sessionId` provided | Route to existing DO instance |
| `sessionId` absent | Create new DO instance, return its ID |

### Deploy Steps

1. Bundle user code as a Worker script
2. Configure Durable Object bindings (if sessionful)
3. Set secrets via Cloudflare API (telemetry key + user secrets)
4. Deploy via Cloudflare Workers API
5. Return `providerRef: { workerName, scriptId, route }`

### Secrets

Secrets are bound as Worker secrets at deploy time. The control plane calls the
Cloudflare Secrets API -- plaintext values never persist in the control plane DB.

### Telemetry

After each invocation, the DO sends telemetry to the control plane:

```typescript
{
  agentId, deploymentId, userId,
  requests: 1,
  llm_tokens: 150,
  compute_ms: 340,
  errors: 0,
  trace_id: "tr_abc123"
}
```

---

## AWS Bedrock AgentCore Adapter

### Execution Model

- Control plane deploys a container-based runtime via AWS SDK (`@aws-sdk/client-bedrock-agentcore`).
- Invocations use AgentCore runtime invoke APIs.
- Optional tools SDK (`bedrock-agentcore`) for code interpreter, browser tools.

### Session Mapping

| Scenario | Behavior |
|----------|----------|
| `sessionId` provided | Resume AgentCore session |
| `sessionId` absent | Create/init new session, return session ID |

### Deploy Steps

1. Build OCI container from uploaded bundle (see `02_DEPLOYMENT_PIPELINE.md`)
2. Push image to ECR
3. Create/update AgentCore runtime referencing the image URI
4. Inject environment variables via AgentCore mechanisms
5. Return `providerRef: { runtimeId, imageUri, region }`

### Secrets

Use AWS-native injection: environment variables via AgentCore runtime config or
Secrets Manager references. Control plane stores only references, not values.

### Telemetry

Capture after each invocation:

```typescript
{
  agentId, deploymentId, userId,
  requests: 1,
  llm_tokens: 200,
  compute_ms: 1200,
  errors: 0,
  session_duration_ms: 5000,
  tool_invocations: 2,
  trace_id: "tr_def456"
}
```

---

## Provider Selection Rules

| Condition | Provider |
|-----------|----------|
| Free / Starter tier | `cloudflare` only |
| Pro / Enterprise tier | `cloudflare` or `agentcore` |
| Low-latency, global edge | `cloudflare` recommended |
| Long-running, enterprise isolation | `agentcore` recommended |

---

## Checklist

- [ ] Every adapter implements `deploy`, `invoke`, `healthcheck`, `estimateCost`
- [ ] Deploy output contains sufficient `providerRef` to invoke
- [ ] Invoke enforces internal timeout (never blocks indefinitely)
- [ ] `sessionId` is treated as opaque by the control plane
- [ ] Secrets flow through provider-native mechanisms (never plaintext in DB)
- [ ] Telemetry is emitted after every invocation
- [ ] Error responses are normalized to the standard code set
- [ ] AgentCore is gated to paid tiers
