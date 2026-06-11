# WebHost.Systems Documentation

> **Deploy AI agents to the edge or the cloud — one API, any runtime.**

> **Part of the [&] Protocol stack** · [Ecosystem overview](../../ECOSYSTEM.md) · [Three-protocol stack](../../PULSE/docs/THREE_PROTOCOL_STACK.md) · [Stack status](../../STACK_COMPLETION.md)

Welcome to the documentation hub for **WebHost.Systems** — a multi-runtime AI
agent deployment and hosting platform built on Supabase, Cloudflare Workers,
and AWS Bedrock AgentCore.

WebHost.Systems serves two roles:

- **Hosting platform for developers** — create agents, deploy code bundles,
  manage secrets, view logs and metrics, and handle billing through a single
  dashboard and API.
- **Hosting layer for the [&] Protocol ecosystem** — validate `ampersand.json`
  manifests, orchestrate MCP sidecars (Graphonomous, TickTickClock, etc.),
  route agent-to-agent skills via A2A, and enforce Delegatic governance.

WebHost.Systems is a Node.js/TypeScript monorepo in the [&] Protocol ecosystem.
Built entirely on Supabase + Vite/React + Cloudflare/AWS runtimes.

---

## What you'll find here

- A practical quickstart that gets a local dev environment running with Supabase, Vite, and Edge Functions
- Architecture documentation covering the control plane / data plane split, RPI abstraction, and request flows
- Skills guides for every operational surface — agent management, deployment, invocation, billing, security, and [&] Protocol integration
- Spec references pointing to the authoritative engineering spec in `docs/spec/`

---

## Quick Links

| Document | Description |
|----------|-------------|
| [Quickstart](quickstart.md) | Local dev setup, first agent, verification |
| [Architecture](architecture.md) | Control plane / data plane design, system diagram |
| [Skills Reference](skills/SKILLS.md) | Operational skills index for agents and engineers |

---

## Documentation Map


```{toctree}
:maxdepth: 1
:caption: Homepages

[&] Ampersand Box <https://ampersandboxdesign.com>
Graphonomous <https://graphonomous.com>
BendScript <https://bendscript.com>
WebHost.Systems <https://webhost.systems>
Agentelic <https://agentelic.com>
AgenTroMatic <https://agentromatic.com>
Delegatic <https://delegatic.com>
Deliberatic <https://deliberatic.com>
FleetPrompt <https://fleetprompt.com>
GeoFleetic <https://geofleetic.com>
OpenSentience <https://opensentience.org>
SpecPrompt <https://specprompt.com>
TickTickClock <https://ticktickclock.com>
```

```{toctree}
:maxdepth: 1
:caption: Root Docs

[&] Protocol Docs <https://docs.ampersandboxdesign.com>
Graphonomous Docs <https://docs.graphonomous.com>
BendScript Docs <https://docs.bendscript.com>
WebHost.Systems Docs <https://docs.webhost.systems>
Agentelic Docs <https://docs.agentelic.com>
AgenTroMatic Docs <https://docs.agentromatic.com>
Delegatic Docs <https://docs.delegatic.com>
Deliberatic Docs <https://docs.deliberatic.com>
FleetPrompt Docs <https://docs.fleetprompt.com>
GeoFleetic Docs <https://docs.geofleetic.com>
OpenSentience Docs <https://docs.opensentience.org>
SpecPrompt Docs <https://docs.specprompt.com>
TickTickClock Docs <https://docs.ticktickclock.com>
```

```{toctree}
:maxdepth: 2
:caption: WebHost.Systems Docs

quickstart
architecture
spec/00_MASTER_SPEC
spec/README
```

```{toctree}
:maxdepth: 1
:caption: Skills

skills/SKILLS
skills/01_AGENT_MANAGEMENT
skills/02_DEPLOYMENT_PIPELINE
skills/03_INVOCATION_GATEWAY
skills/04_RUNTIME_PROVIDERS
skills/05_TELEMETRY_AND_METRICS
skills/06_BILLING_AND_LIMITS
skills/07_SECURITY_AND_SECRETS
skills/08_AMPERSAND_INTEGRATION
skills/09_ANTI_PATTERNS
```

---

## Suggested Reading Order

If you're new to the project, follow this path:

1. **quickstart** — local dev setup, first agent creation, verification
2. **architecture** — control plane / data plane design, request flows, data model
3. **skills/SKILLS** — skills registry and tool inventory
4. **skills/01_AGENT_MANAGEMENT** — agent CRUD, status lifecycle, provider config
5. **skills/02_DEPLOYMENT_PIPELINE** — bundle upload, validation, immutable deployments
6. **skills/03_INVOCATION_GATEWAY** — request/response shapes, auth, streaming
7. **skills/04_RUNTIME_PROVIDERS** — RPI abstraction, Cloudflare and AgentCore adapters
8. **skills/05_TELEMETRY_AND_METRICS** — metrics schema, aggregation
9. **skills/06_BILLING_AND_LIMITS** — subscription tiers, enforcement, checkout
10. **skills/07_SECURITY_AND_SECRETS** — RLS isolation, Vault secrets, audit
11. **skills/08_AMPERSAND_INTEGRATION** — [&] manifests, MCP sidecars, A2A routing
12. **skills/09_ANTI_PATTERNS** — common mistakes and how to avoid them

For **operations and DevOps**, start at **skills/02_DEPLOYMENT_PIPELINE** and
**skills/04_RUNTIME_PROVIDERS**.

For **[&] Protocol integration**, start at **skills/08_AMPERSAND_INTEGRATION**
and the `70_AMPERSAND_PROTOCOL_INTEGRATION.md` spec.

---

## Core Concepts

### Control Plane

The Supabase-backed layer that manages all platform state — agents, deployments,
secrets, billing, and telemetry. Built on PostgreSQL with RLS for per-tenant
isolation, Edge Functions for server-only logic, and Vault for encrypted secret
storage.

### Data Plane

Where agent code actually runs. WebHost supports two runtime providers behind a
single abstraction:

| Runtime | Strengths | Best for |
|---------|-----------|----------|
| **Cloudflare Workers + DO** | Global edge, strong economics, instant cold starts | Most agents (default) |
| **AWS Bedrock AgentCore** | Long-running sessions, enterprise isolation, built-in tools | Premium/enterprise workloads |

### Runtime Provider Interface (RPI)

The abstraction layer that makes runtime portability possible. The RPI defines a
consistent contract for deployment, invocation, session management, and telemetry
across all providers. Deploy once, run anywhere.

### Deployment Immutability

Deployments are append-only records. You never mutate a deployment — you create a
new one. Rollback works by changing the active pointer, not by reverting code.
This gives you a full audit trail and instant rollback.

### Metered Telemetry

Every invocation emits authenticated metrics — requests, tokens, compute
milliseconds, errors. Telemetry feeds both the dashboard and the billing engine,
so usage tracking and limit enforcement are built in, not bolted on.

---

## Core Idea

A concise framing for the platform:

> Supabase manages the control plane.
> Cloudflare and AgentCore run the data plane.
> The RPI makes them interchangeable.

The goal is not to build another LLM provider, but to provide a **runtime-portable
hosting layer** where AI agents deploy, scale, and meter under a single API —
regardless of which cloud actually executes the code.

---

## Spec References

The authoritative engineering spec lives in `docs/spec/`:

- [Spec index — Implementation-Ready Document Set](spec/README.md)
- [00 — Master Spec](spec/00_MASTER_SPEC.md)
- [10 — API Contracts](spec/10_API_CONTRACTS.md)
- [20 — Runtime Provider Interface](spec/20_RUNTIME_PROVIDER_INTERFACE.md)
- [30 — Data Model (Supabase/PostgreSQL) & Access Control](spec/30_DATA_MODEL_SUPABASE.md)
- [40 — Security, Secrets, and Compliance](spec/40_SECURITY_SECRETS_COMPLIANCE.md)
- [50 — Observability, Metering, Cost, Tiers, and Limit Enforcement](spec/50_OBSERVABILITY_BILLING_LIMITS.md)
- [60 — Testing Plan & Acceptance Criteria](spec/60_TESTING_ACCEPTANCE.md)
- [70 — Ampersand Protocol Integration](spec/70_AMPERSAND_PROTOCOL_INTEGRATION.md)
- [Spec-to-Implementation Realignment Plan](spec/REALIGNMENT_PLAN.md)

### Architecture decision records

- [ADR-0001 — Multi-Runtime Strategy](spec/adr/ADR-0001-multi-runtime.md)
- [ADR-0002 — Supabase as the Control Plane Backend](spec/adr/ADR-0002-supabase-control-plane.md)
- [ADR-0003 — Secrets Handling & Provider Injection Strategy](spec/adr/ADR-0003-secrets-strategy.md)
- [ADR-0004 — Telemetry Integrity & Attribution Model](spec/adr/ADR-0004-telemetry-integrity.md)
- [ADR-0005 — Deployment Immutability + Active Deployment Pointer Model](spec/adr/ADR-0005-deployment-immutability.md)
- [ADR-0006 — Canonical Invocation Protocol (invoke/v1) and Streaming](spec/adr/ADR-0006-invocation-protocol.md)
- [ADR-0007 — Tier Entitlements, Runtime Gating, and Limit Enforcement](spec/adr/ADR-0007-entitlements-and-limits.md)
- [ADR-0008 — Delegated Invocation Auth Mode (Server-to-Server HMAC)](spec/adr/ADR-0008-delegated-invocation-auth.md)

### Progress logs & UX

- [Daily Engineering Progress Logs](spec/progress/README.md)
- [Progress Log — 2026-01-23](spec/progress/2026-01-23.md)
- [Progress Log — 2026-01-24](spec/progress/2026-01-24.md)
- [User Stories](ux/user-stories.md)

---

## Monorepo Structure

```
WebHost.Systems/
  apps/
    web/              -- Dashboard frontend (Vite + React + Supabase Auth)
    control-plane/    -- Supabase backend (Edge Functions + RPC)
  supabase/           -- Supabase project (migrations, Edge Functions, seed)
  packages/           -- Shared packages
  docs/               -- This documentation
    spec/             -- Authoritative engineering spec
    skills/           -- Operational skills reference
```

---

## Project Links

- **Master spec:** [Engineering Specification](spec/00_MASTER_SPEC.md)
- **ADRs:** `docs/spec/adr/`
- **[&] Protocol integration:** [Ampersand Integration](spec/70_AMPERSAND_PROTOCOL_INTEGRATION.md)
- **[&] Protocol ecosystem:** `AmpersandBoxDesign/`
