# WebHost.Systems

AI-driven web hosting platform. Node.js monorepo with Convex serverless backend and Vite/React/Clerk frontend.

## Source-of-truth spec

- `project_spec/spec_v1/00_MASTER_SPEC.md` — master engineering spec (self-contained, implementation-ready)
- `project_spec/spec_v1/10_API_CONTRACTS.md` — API contract details
- `project_spec/spec_v1/20_RUNTIME_PROVIDER_INTERFACE.md` — runtime provider abstraction
- `project_spec/spec_v1/30_DATA_MODEL_CONVEX.md` — Convex data model
- `project_spec/spec_v1/40_SECURITY_SECRETS_COMPLIANCE.md` — security requirements
- `project_spec/spec_v1/50_OBSERVABILITY_BILLING_LIMITS.md` — billing and limits
- `project_spec/spec_v1/60_TESTING_ACCEPTANCE.md` — test plan
- `project_spec/spec_v1/adr/` — architecture decision records
- `project_spec/progress/` — implementation progress logs

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
npm run convex:dev             # Convex backend dev mode
```

## Monorepo structure

- `apps/web/` — Dashboard frontend (Vite + React + Clerk auth)
- `apps/control-plane/` — Convex serverless backend (TypeScript + Zod validation)
- `packages/` — shared packages

## Key details

- Node >= 20 required
- Convex for serverless backend — functions in `apps/control-plane/convex/`
- Clerk for authentication in the frontend
- Zod for runtime validation
- TypeScript strict mode
- ESLint + Prettier enforced
- v0.0.0 — early stage, greenfield
