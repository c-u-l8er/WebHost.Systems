# WebHost.Systems

Hosting and deployment control plane for the [&] Protocol portfolio, and the
marketing page that fronts it. Part of the [ComputeDriven](https://computedriven.com)
world — the **runtime** layer.

**Written 2026-08-16.** This repository had no README before that date. Every
number and status below was measured on that day by running the command beside
it, not carried over from a planning document.

---

## Status, honestly

| | |
|---|---|
| Marketing page | **live** — `https://webhost.systems` answers 200 |
| Application | **in development.** No deployed app; `apps/web` builds and runs locally |
| Tests | **143 passing across 12 files** (`npm test`, 0 failures) |
| Types | clean (`npm run typecheck`, `tsc --noEmit`) |
| Spec | v1, and its data-layer half is **superseded** — see below |
| Evidence rung | `live_local` for the app, `live_deployed` for the marketing page |

**A known defect, not yet fixed:** the live marketing page advertises a
**Convex** backend in its `#stack` section. This repository does not use Convex.
`apps/web/package.json` depends on `@supabase/supabase-js`, and there is no
`convex` or `@clerk/*` dependency anywhere in the tree. The same wrong claim
reached the root `AGENTS.md` and four `docs/spec/` documents, which have been
corrected; **the page itself has not been.** If you are here to fix one thing,
fix that.

## Layout

```
index.html          the marketing page served at webhost.systems
apps/web/           the application — Vite + React + TypeScript, Supabase client
docs/spec/          the v1 specification set (see the supersession note)
amp-nav.js          portfolio nav — DEPLOYED here, not edited here (see below)
old_scrap/          previous versions, historical, not authoritative
```

`package.json` declares npm workspaces at `apps/*` and `packages/*`. There is
currently one workspace, `apps/web`; `packages/` does not exist yet.

## Quick start

```bash
npm install
npm run dev          # Vite dev server for apps/web
npm run typecheck    # tsc --noEmit across workspaces
npm test             # vitest across workspaces
npm run lint
npm run build
```

`npm run supabase:start` and `supabase:stop` are still in `package.json` and
still work. **They start the abandoned data layer** — see the next section
before you rely on them.

## The data layer is abandoned, and this repository still uses it

Ruled by Travis on **2026-07-30**: the shared-Supabase route is abandoned and
replaced by `studbook`. That matters here more than anywhere else in the
portfolio, because WebHost is the product that used it most.

Three facts, in the order you need them:

1. **`studbook` is a specification with no implementation**, and it is blocked
   on one unruled question — where confidentiality comes from. **Do not build
   against it yet.**
2. **`ampersand-supabase/` is archived, not switched off.** Its 40 migrations
   across 10 schemas still apply and the code written against them still runs.
   Nothing migrates until studbook can hold the same data with the same
   guarantees.
3. **So this repository keeps working exactly as it does today.** What changed
   is the destination, not the present. `docs/spec/README.md`,
   `00_MASTER_SPEC.md` and `30_DATA_MODEL_SUPABASE.md` each carry a supersession
   banner naming which half is superseded — the tables, RLS policies and
   `amp.profiles` identity — and which half stands, which is all the product,
   API and UX design.

Read the banner before building from any of those documents.

## The portfolio nav

`amp-nav.js` and `apps/web/amp-nav.js` are **deployed copies**. The source is
`ampersand-nav/src/amp-nav.js` in the ProjectAmp2 workspace, fanned out to 26
targets by `sync-nav.sh`. **Editing either copy here loses the edit** on the
next sync. Fix the source.

## Conventions

- TypeScript with ESLint + Prettier; `npm run format:check` in CI.
- Node >= 20.
- Never commit secrets. `apps/web/env.example` shows the shape.
- Do not add a dependency to make a marketing claim true — fix the claim.

## Related

- [computedriven.com](https://computedriven.com) — the discipline this is built under
- [ampersandboxdesign.com](https://ampersandboxdesign.com) — the [&] Protocol
- `docs/spec/` — the specification, superseded in part
