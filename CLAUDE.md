# WebHost.Systems

AI-driven web hosting platform. Node.js monorepo with Supabase backend (PostgreSQL + Edge Functions) and Vite/React frontend with Supabase Auth.

## Source-of-truth spec

- `project_spec/spec_v1/00_MASTER_SPEC.md` — master engineering spec (self-contained, implementation-ready)
- `project_spec/spec_v1/10_API_CONTRACTS.md` — API contract details
- `project_spec/spec_v1/20_RUNTIME_PROVIDER_INTERFACE.md` — runtime provider abstraction
- `project_spec/spec_v1/30_DATA_MODEL_SUPABASE.md` — Supabase/PostgreSQL data model
- `project_spec/spec_v1/40_SECURITY_SECRETS_COMPLIANCE.md` — security requirements
- `project_spec/spec_v1/50_OBSERVABILITY_BILLING_LIMITS.md` — billing and limits
- `project_spec/spec_v1/60_TESTING_ACCEPTANCE.md` — test plan
- `project_spec/spec_v1/70_AMPERSAND_PROTOCOL_INTEGRATION.md` — [&] Protocol integration (capability manifests, MCP sidecars, A2A routing, governance)
- `project_spec/spec_v1/adr/` — architecture decision records
- `project_spec/progress/` — implementation progress logs

## [&] Protocol role

WebHost.Systems is the **hosting layer** for [&] Protocol agents. The §70 integration spec extends the v1 platform with:
- `ampersand.json` manifest validation and storage
- MCP sidecar orchestration (Graphonomous, TickTickClock, etc.)
- Agent-to-agent skill routing (A2A)
- Delegatic governance enforcement
- Dynamic capability provider resolution
- Hash-linked provenance in telemetry

Always read the master spec and relevant section before implementing features.

## Build and verify

```
npm install                    # install all workspaces
npm run typecheck              # TypeScript check across workspaces
npm run lint                   # ESLint across workspaces
npm run format:check           # Prettier check
```

## Development

```
npm run dev                    # Vite dev server (apps/web)
cd .. && supabase start        # Local Supabase from repo root (all ecosystem schemas)
```

## Monorepo structure

- `apps/web/` — Dashboard frontend (Vite + React + Supabase Auth)
- `packages/` — shared packages

## Shared Supabase data layer

WebHost.Systems uses the **shared ecosystem Supabase** at the repo root (`/supabase/`), not a local supabase directory. Its tables live in the `webhost.*` PostgreSQL schema.

- Schema: `/supabase/migrations/020_webhost_schema.sql`
- RLS: `/supabase/migrations/021_webhost_rls.sql`
- Cron jobs: `/supabase/migrations/022_webhost_cron.sql`
- Architecture: `/supabase/ARCHITECTURE.md`

Run `supabase start` from the repo root to start the full ecosystem DB.

## Key details

- Node >= 20 required
- Supabase for backend — PostgreSQL + RLS + Edge Functions in root `supabase/`
- Supabase Auth for authentication (shared across all [&] ecosystem apps)
- Zod for runtime validation
- TypeScript strict mode
- ESLint + Prettier enforced
- v0.0.0 — early stage, greenfield
