# WebHost.Systems Architecture

> **Purpose:** Explain the control plane / data plane split, component
> responsibilities, and canonical request flows for the WebHost.Systems
> multi-runtime AI agent deployment platform.

---

## Design Principles

1. **Runtime portability** -- A single abstraction (RPI) across Cloudflare Workers/DO and AWS Bedrock AgentCore.
2. **Tenant isolation** -- RLS on every table; no cross-tenant data leakage.
3. **Deployment immutability** -- Deployments are append-only records; rollback via active pointer.
4. **Metered by default** -- Every invocation emits authenticated telemetry.
5. **TypeScript-first** -- End-to-end TypeScript across control plane and data plane.

---

## System Diagram (Text)

```
                         +------------------+
                         |   Web Dashboard  |
                         | (Vite + React +  |
                         |    Clerk Auth)   |
                         +--------+---------+
                                  |
                         Supabase Auth JWT
                                  |
                  +---------------v----------------+
                  |        CONTROL PLANE            |
                  |   (Supabase: PostgreSQL +       |
                  |    PostgREST + Edge Functions    |
                  |    + Realtime + Vault)           |
                  |                                  |
                  |  +----------+  +-------------+  |
                  |  | Agent    |  | Deployment  |  |
                  |  | CRUD/RPC |  | Orchestrator|  |
                  |  +----------+  +-------------+  |
                  |  +----------+  +-------------+  |
                  |  | Billing  |  | Telemetry   |  |
                  |  | Engine   |  | Ingestion   |  |
                  |  +----------+  +-------------+  |
                  +-----+------------------+--------+
                        |                  |
              +---------v------+   +-------v---------+
              |   DATA PLANE   |   |   DATA PLANE    |
              |  (Cloudflare)  |   |  (AgentCore)    |
              |                |   |                  |
              | Workers + DO   |   | AWS Bedrock      |
              | Edge execution |   | Container runtime|
              | Session via DO |   | Session via SDK  |
              +-------+--------+   +--------+---------+
                      |                      |
                      +--- Telemetry Events -+
                                  |
                         +--------v---------+
                         | metrics_events   |
                         | (PostgreSQL)     |
                         +--------+---------+
                                  |
                         pg_cron aggregation
                                  |
                         +--------v---------+
                         | billing_usage    |
                         +------------------+
```

---

## Component Responsibilities

### Control Plane (Supabase)

| Component | Responsibility |
|-----------|---------------|
| **PostgreSQL** | Agents, deployments, metrics_events, billing_usage, users |
| **PostgREST** | Auto-generated REST for CRUD with RLS enforcement |
| **RPC Functions** | Business logic: create_agent, disable, rollback |
| **Edge Functions** | Server-only: deploy orchestration, invoke gateway, telemetry ingestion, billing webhooks |
| **Supabase Auth** | Email + OAuth (Google, GitHub); JWT issuance |
| **Supabase Vault** | Encrypted secret storage (never plaintext in DB) |
| **Realtime** | Live dashboard updates via LISTEN/NOTIFY |
| **pg_cron** | Periodic aggregation of metrics into billing_usage |

### Data Plane

| Provider | Execution Model | Session Model |
|----------|----------------|---------------|
| **Cloudflare Workers/DO** | Worker routes to Durable Object for stateful sessions | `sessionId` = DO instance key |
| **AWS Bedrock AgentCore** | Container-based runtime via AWS SDK | `sessionId` = AgentCore session ID |

---

## Canonical Request Flows

### Flow A: Create Agent

```
UI -> POST /rest/v1/rpc/create_agent (RLS: auth.uid() = user_id)
   -> INSERT into agents (status: created)
   -> Return agent record
```

### Flow B: Deploy Agent

```
UI -> POST /functions/v1/deploy (Edge Function)
   -> Validate bundle (agent.config.json, entrypoint, size)
   -> INSERT into deployments (status: deploying)
   -> Call RPI adapter: deploy(artifact, config, secrets)
   -> On success: UPDATE deployment status -> active
                  SET agents.active_deployment_id
   -> On failure: UPDATE deployment status -> failed
                  SET error_message
```

### Flow C: Invoke Agent

```
Client -> POST /functions/v1/invoke/:agentId (Edge Function)
       -> Authenticate (Supabase Auth JWT)
       -> Check plan limits (billing_usage vs tier)
       -> Resolve active deployment + runtime provider
       -> Call RPI adapter: invoke(input, sessionId?, options)
       -> Return normalized response (output, usage, traceId)
       -> Data plane emits telemetry event async
```

### Flow D: Usage Aggregation

```
Data plane -> POST /functions/v1/metrics/report (HMAC-authenticated)
           -> INSERT into metrics_events
pg_cron    -> Aggregate metrics_events into billing_usage by period
Dashboard  -> SELECT billing_usage WHERE user_id = auth.uid()
```

---

## Data Model (Key Tables)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | Account + subscription tier | id, email, subscription_tier |
| `agents` | Logical AI service | id, user_id, runtime_provider, status, active_deployment_id |
| `deployments` | Immutable version record | id, agent_id, version, status, artifact, provider_ref |
| `metrics_events` | Raw per-invocation telemetry | agent_id, requests, llm_tokens, compute_ms, cost_usd_estimated |
| `billing_usage` | Aggregated usage per period | user_id, period_key, total_requests, total_tokens |

All tables enforce RLS: `auth.uid() = user_id`.

---

## Security Boundaries

- Control plane never executes customer agent code.
- Data plane never has broad access to other tenants' data.
- Secrets flow: Supabase Vault -> provider secret mechanism at deploy time.
- Telemetry is HMAC-signed or JWT-authenticated; unauthenticated events are rejected.

---

## Further Reading

- [Skills Reference](skills/SKILLS.md) -- Operational guides
- [Master Spec](../project_spec/spec_v1/00_MASTER_SPEC.md) -- Full engineering spec
- [RPI Spec](../project_spec/spec_v1/20_RUNTIME_PROVIDER_INTERFACE.md) -- Provider adapter contracts
