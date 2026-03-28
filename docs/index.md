# WebHost.Systems Documentation

> **Purpose:** Comprehensive documentation for the WebHost.Systems multi-runtime
> AI agent deployment platform. Covers architecture, operations, security, and
> integration with the [&] Protocol ecosystem.

---

## Quick Links

| Document | Description |
|----------|-------------|
| [Quickstart](quickstart.md) | Get up and running in 5 minutes |
| [Architecture](architecture.md) | Control plane / data plane design |
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
```

```{toctree}
:maxdepth: 1
:caption: Root Docs

[&] Protocol Docs <https://docs.ampersandboxdesign.com>
Graphonomous Docs <https://docs.graphonomous.com>
BendScript Docs <https://docs.bendscript.com>
WebHost.Systems Docs <https://docs.webhost.systems>
```

```{toctree}
:maxdepth: 2
:caption: WebHost.Systems Docs

quickstart
architecture
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

---

## Spec References

The authoritative engineering spec lives in `project_spec/spec_v1/`:

- `00_MASTER_SPEC.md` — Self-contained master spec
- `10_API_CONTRACTS.md` — API contracts and error codes
- `20_RUNTIME_PROVIDER_INTERFACE.md` — RPI abstraction
- `30_DATA_MODEL_SUPABASE.md` — Supabase/PostgreSQL data model with RLS
- `40_SECURITY_SECRETS_COMPLIANCE.md` — Security requirements
- `50_OBSERVABILITY_BILLING_LIMITS.md` — Billing and limits
- `60_TESTING_ACCEPTANCE.md` — Test plan and acceptance criteria
- `70_AMPERSAND_PROTOCOL_INTEGRATION.md` — [&] Protocol integration

---

## Monorepo Structure

```
WebHost.Systems/
  apps/
    web/              -- Dashboard frontend (Vite + React + Supabase Auth)
    control-plane/    -- Supabase backend (Edge Functions + RPC)
  supabase/           -- Supabase project (migrations, Edge Functions, seed)
  packages/           -- Shared packages
  project_spec/       -- Authoritative engineering spec
  docs/               -- This documentation
    skills/           -- Operational skills reference
```
