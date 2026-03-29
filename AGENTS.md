# WebHost.Systems

Node.js monorepo for an AI-driven web hosting platform. Convex serverless backend + Vite/React/Clerk frontend.

## Source-of-truth spec

- `docs/spec/spec_v1/00_MASTER_SPEC.md` — master engineering spec
- Numbered section files (10-70) in same dir for API contracts, data model, security, billing, testing, and [&] Protocol integration
- `docs/spec/spec_v1/adr/` — architecture decision records
- `docs/spec/progress/` — implementation progress logs

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

## [&] Protocol Integration

WebHost.Systems is the hosting layer for [&] Protocol agents. See `docs/spec/spec_v1/70_AMPERSAND_PROTOCOL_INTEGRATION.md` for:
- `ampersand.json` manifest support (capability declarations)
- MCP sidecar orchestration (Graphonomous, TickTickClock, etc.)
- Agent-to-agent skill routing (A2A)
- Delegatic governance enforcement
- Dynamic capability provider resolution

## Constraints

- Node >= 20
- TypeScript strict mode
- ESLint + Prettier enforced
- Convex functions live in `apps/control-plane/convex/`
- Clerk handles auth in the frontend
