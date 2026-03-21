# WebHost.Systems

Node.js monorepo for an AI-driven web hosting platform. Convex serverless backend + Vite/React/Clerk frontend.

## Source-of-truth spec

- `project_spec/spec_v1/00_MASTER_SPEC.md` — master engineering spec
- Numbered section files (10-60) in same dir for API contracts, data model, security, billing, testing
- `project_spec/spec_v1/adr/` — architecture decision records
- `project_spec/progress/` — implementation progress logs

Read the master spec before implementing features.

## Build and test

```
npm install
npm run typecheck
npm run lint
npm run format:check
```

## Development

```
npm run dev           # Vite frontend dev server
npm run convex:dev    # Convex backend dev mode
```

## Structure

- `apps/web/` — Vite + React + Clerk dashboard
- `apps/control-plane/` — Convex serverless functions + Zod validation
- `packages/` — shared workspace packages

## Constraints

- Node >= 20
- TypeScript strict mode
- ESLint + Prettier enforced
- Convex functions live in `apps/control-plane/convex/`
- Clerk handles auth in the frontend
