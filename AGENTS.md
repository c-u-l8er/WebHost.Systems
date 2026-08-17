# WebHost.Systems

Node.js monorepo. A control plane for [&] Protocol agents — a Postgres schema,
a set of edge functions, and a Vite/React/TypeScript dashboard against a
Supabase client. **It does not execute an agent on a runtime.**

**Rewritten 2026-08-17.** Until that date this file described a serverless
backend and an auth provider this repository has never depended on, and sent
readers to a control-plane workspace and a shared-packages directory, neither of
which exists on disk. Those are the same claims the marketing page carried and
retracted on 2026-08-16; the retraction did not reach this file, so they were
taken off the page a visitor reads and left standing in the file every agent
reads first. Every path below was checked to exist before it was written, and
`launch-gate.mjs` now refuses the build if one of them stops existing — or if
this file starts naming that stack again.

## What is here

```
index.html          the marketing page — GENERATED, see below
src/                the marketing page's template, stylesheet and two scripts
records/            the frozen records the page is generated from
build-site.mjs      emits index.html, boot.js, say.js
launch-gate.mjs     reads the artifact and refuses to publish a page that lies
apps/web/           the dashboard — Vite + React + TypeScript, Supabase client
docs/spec/          the v1 specification set, part of it superseded
amp-nav.js          portfolio nav, a DEPLOYED copy — do not edit it here
old_scrap/          previous versions, historical, not authoritative
```

`package.json` declares npm workspaces at `apps/*` and `packages/*`. There is
one workspace, `apps/web`. **`packages/` does not exist**, so there is no SDK
and no CLI, and the marketing page says so with a probe that re-checks it on
every build.

The edge functions and migrations this product runs on are **not in this
repository**. They live in the sibling `ampersand-supabase/` repo, under
`functions/webhost-*` and `migrations/*webhost*`.

## The marketing page is GENERATED. Do not hand-edit `index.html`.

`/index.html`, `/boot.js` and `/say.js` are emitted by `build-site.mjs` from
`records/surface.json`, `records/evidence.json`, `src/landing.html`,
`src/shell.css`, `src/boot.js` and `src/say.js`. **An edit to the served HTML is
silently reverted by the next build.** Change the record or the template.

```
npm run site:launch   # emit the page, then prove it
```

`launch-gate.mjs` reads the emitted artifact and refuses to publish when it and
the records disagree — a retracted claim reinstated (anywhere, including inside
a comment or an attribute), a rung invented, a call to action the rung has not
earned, a hand-typed count, a cited source line that has stopped saying what it
is quoted as saying, a `mailto:`, a text token below 4.5:1, a button whose
colour is decided by a non-button rule, an artifact that is not what its source
compiles to, or an animation constant leaking into the copy. The gate prints
its own total; **do not hand-type a check count anywhere**, that is how the
published and printed numbers drift apart.

Most of the page's claims are NEGATIVE — "there is no AWS dependency", "nothing
reads an `ampersand.json`", "`packages/` does not exist". Those are the ones the
build re-derives off disk on every run, because nobody edits a sentence on a
marketing page when they add a dependency.

**The three `site:*` scripts are deliberately not wired into `build`, `dev` or
`test`.** Those belong to `apps/web`, which is a separate artifact with a
separate toolchain. Do not entangle them.

## Source-of-truth spec

- `docs/spec/00_MASTER_SPEC.md` — master engineering spec
- `docs/spec/10_API_CONTRACTS.md` · `20_RUNTIME_PROVIDER_INTERFACE.md` ·
  `30_DATA_MODEL_SUPABASE.md` · `40_SECURITY_SECRETS_COMPLIANCE.md` ·
  `50_OBSERVABILITY_BILLING_LIMITS.md` · `60_TESTING_ACCEPTANCE.md` ·
  `70_AMPERSAND_PROTOCOL_INTEGRATION.md`
- `docs/spec/adr/` — architecture decision records
- `docs/spec/progress/` — implementation progress logs
- `docs/spec/REALIGNMENT_PLAN.md`

Read the master spec before implementing features, **and read its supersession
banner first**: the data-layer half of the spec set is superseded. See README.md.

## [&] Protocol integration — specified, not implemented

`docs/spec/70_AMPERSAND_PROTOCOL_INTEGRATION.md` describes `ampersand.json`
manifest support, MCP sidecar orchestration, agent-to-agent routing and
Delegatic governance enforcement. **None of it is built.** No code in this
repository or in the sibling edge functions reads an `ampersand.json`; the build
counts the source files that so much as mention one, and the count is zero.

## Build and test

```
npm install
npm run dev            # Vite dev server for apps/web
npm test               # vitest across workspaces
npm run typecheck
npm run lint
npm run format:check
npm run site:launch    # the marketing page: emit, then prove
```

## Constraints

- Node >= 20
- TypeScript strict mode; ESLint + Prettier enforced
- Never commit secrets. `apps/web/env.example` shows the shape.
- **Do not add a dependency to make a marketing claim true — fix the claim.**
