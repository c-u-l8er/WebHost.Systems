# WebHost.Systems

A control plane for [&] Protocol agents. Node.js monorepo with a Supabase
backend (PostgreSQL + Edge Functions) and a Vite/React frontend with Supabase
Auth. **It does not execute an agent on a runtime** — the deploy path writes a
version row and marks the provider reference `simulated`, and the invocation
endpoint reaches a model provider. See `README.md`.

## The marketing page is GENERATED. Do not hand-edit `index.html`.

`/index.html`, `/boot.js` and `/say.js` are emitted by `build-site.mjs` from
`records/surface.json`, `records/evidence.json` and `src/`. **An edit to the
served HTML is silently reverted by the next build.** Change the record or the
template, then run `npm run site:launch`, which emits the page and then runs
`launch-gate.mjs` against the artifact. The shell is documented in
`ProjectAmp2/agents/SHELL.md`; this surface is built against revision
`shell-r9`, recorded as `shell_revision` in `records/surface.json`.

`site:build` / `site:gate` / `site:launch` are **not** wired into `build`,
`dev` or `test` — those belong to `apps/web`, a separate artifact.

## Source-of-truth spec

- `docs/spec/00_MASTER_SPEC.md` — master engineering spec (self-contained, implementation-ready)
- `docs/spec/10_API_CONTRACTS.md` — API contract details
- `docs/spec/20_RUNTIME_PROVIDER_INTERFACE.md` — runtime provider abstraction
- `docs/spec/30_DATA_MODEL_SUPABASE.md` — Supabase/PostgreSQL data model
- `docs/spec/40_SECURITY_SECRETS_COMPLIANCE.md` — security requirements
- `docs/spec/50_OBSERVABILITY_BILLING_LIMITS.md` — billing and limits
- `docs/spec/60_TESTING_ACCEPTANCE.md` — test plan
- `docs/spec/70_AMPERSAND_PROTOCOL_INTEGRATION.md` — [&] Protocol integration (capability manifests, MCP sidecars, A2A routing, governance)
- `docs/spec/adr/` — architecture decision records
- `docs/spec/progress/` — implementation progress logs

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
- `packages/` — **declared by the workspace glob and absent from disk.** There
  is no SDK and no CLI. The page build re-checks this every run and refuses if
  one appears without the page being updated.
- `src/`, `records/`, `build-site.mjs`, `launch-gate.mjs` — the marketing page

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
