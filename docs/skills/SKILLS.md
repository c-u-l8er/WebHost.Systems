# WebHost.Systems — Operational Skills

> **Purpose:** Teach engineers and AI agents how to operate, deploy to, and
> troubleshoot the WebHost.Systems multi-runtime AI agent deployment platform.
> Drop these files into your context so you know *when*, *why*, and *how* to
> perform each operation.

---

## Quick Orientation

WebHost.Systems is a **multi-runtime AI agent deployment platform** with:

- A **control plane** (Supabase: PostgreSQL + Edge Functions + Auth + Realtime + Vault) for agent management, deployment orchestration, billing, and telemetry.
- A **data plane** (Cloudflare Workers/DO or AWS Bedrock AgentCore) for executing customer agent code.
- A **dashboard** (Vite + React + Clerk) for visual management.

The core workflow is: **create agent -> deploy bundle -> invoke -> observe metrics -> manage billing**.

---

## Skill Files

| File | What It Teaches |
|------|----------------|
| [01_AGENT_MANAGEMENT.md](01_AGENT_MANAGEMENT.md) | Agent CRUD, status state machine, provider config, RLS isolation |
| [02_DEPLOYMENT_PIPELINE.md](02_DEPLOYMENT_PIPELINE.md) | Bundle upload, validation, immutable deployments, rollback |
| [03_INVOCATION_GATEWAY.md](03_INVOCATION_GATEWAY.md) | Request/response shapes, auth checks, streaming, error codes |
| [04_RUNTIME_PROVIDERS.md](04_RUNTIME_PROVIDERS.md) | RPI abstraction, Cloudflare and AgentCore adapters |
| [05_TELEMETRY_AND_METRICS.md](05_TELEMETRY_AND_METRICS.md) | Metrics schema, HMAC auth, pg_cron aggregation |
| [06_BILLING_AND_LIMITS.md](06_BILLING_AND_LIMITS.md) | Subscription tiers, enforcement, checkout + webhooks |
| [07_SECURITY_AND_SECRETS.md](07_SECURITY_AND_SECRETS.md) | RLS isolation, Vault secrets, telemetry auth, audit |
| [08_AMPERSAND_INTEGRATION.md](08_AMPERSAND_INTEGRATION.md) | [&] Protocol manifests, MCP sidecars, A2A routing |
| [09_ANTI_PATTERNS.md](09_ANTI_PATTERNS.md) | Common mistakes and how to avoid them |

---

## API / CLI Tool Inventory

### Control Plane (Supabase RPC + Edge Functions)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/rest/v1/rpc/create_agent` | POST | Create a new agent |
| `/rest/v1/rpc/update_agent` | POST | Update agent metadata |
| `/rest/v1/rpc/disable_agent` | POST | Disable an agent (reject invocations) |
| `/rest/v1/agents` | GET | List agents (PostgREST, RLS-filtered) |
| `/functions/v1/deploy` | POST | Upload bundle and deploy to runtime |
| `/functions/v1/invoke/:agentId` | POST | Invoke an agent |
| `/rest/v1/rpc/rollback_deployment` | POST | Switch active deployment pointer |
| `/functions/v1/metrics/report` | POST | Ingest telemetry (HMAC-authenticated) |
| `/rest/v1/rpc/get_usage` | POST | Query billing usage for a period |
| `/functions/v1/billing/checkout` | POST | Create billing checkout session |
| `/functions/v1/billing/webhook` | POST | Handle billing provider webhooks |

### Build / Dev Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install all workspace dependencies |
| `npm run dev` | Start Vite dev server |
| `npm run typecheck` | TypeScript check across workspaces |
| `npm run lint` | ESLint across workspaces |
| `npm run format:check` | Prettier formatting check |

---

## Reading Order

**For new engineers:** Start with `01_AGENT_MANAGEMENT` through `03_INVOCATION_GATEWAY` for the core workflow, then `07_SECURITY_AND_SECRETS` for safety. Read the rest as needed.

**For operations:** Focus on `04_RUNTIME_PROVIDERS`, `05_TELEMETRY_AND_METRICS`, and `06_BILLING_AND_LIMITS`.

**For [&] Protocol integration:** Read `08_AMPERSAND_INTEGRATION` after understanding the base platform.

**For everyone:** Read `09_ANTI_PATTERNS` to avoid common mistakes.

---

## Spec References

These skills summarize and operationalize the authoritative spec:

- `docs/spec/00_MASTER_SPEC.md` -- Master engineering spec
- `docs/spec/10_API_CONTRACTS.md` -- API contracts
- `docs/spec/20_RUNTIME_PROVIDER_INTERFACE.md` -- RPI spec
- `docs/spec/70_AMPERSAND_PROTOCOL_INTEGRATION.md` -- [&] Protocol integration
