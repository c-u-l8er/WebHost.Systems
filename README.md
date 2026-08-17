# WebHost.Systems

Hosting and deployment control plane for the [&] Protocol portfolio, and the
marketing page that fronts it. Part of the [ComputeDriven](https://computedriven.com)
world — the **runtime** layer.

**Written 2026-08-16, revised 2026-08-17.** This repository had no README before
that date. Every number and status below was measured by running the command
beside it, not carried over from a planning document.

---

## Status, honestly

| | |
|---|---|
| Marketing page | **rebuilt on the ComputeDriven shell 2026-08-17, and GENERATED — do not hand-edit `index.html`** |
| What the domain serves | `https://webhost.systems` answers 200 with the **pre-takedown page**: 77,450 bytes, byte-identical to this repository at `a38212e~1`. Neither the takedown commit nor this one has been pushed |
| Application | **in development, and its deployment is gone.** `app.webhost.systems` returned NXDOMAIN on 2026-08-17 — the hostname no longer resolves at all, where on 2026-08-16 it still served a build whose Supabase project had stopped resolving |
| Tests | **143 passing across 12 files** (`npm test`, 0 failures, re-run 2026-08-17 — and re-run by `build-site.mjs` on every page build, so the count on the page cannot be typed) |
| Types | clean (`npm run typecheck`, `tsc --noEmit`) |
| Spec | v1, and its data-layer half is **superseded** — see below |
| Evidence rung | **`?`** — see the next section |

### Why the rung is `?` and not `in_tree`

A rung names the best-evidenced **shipped** artifact of a surface. Nothing here
is shipped: the deploy path stops at a database row, the dashboard's deployment
has been withdrawn, and what this domain hosts is being decided again. The
control plane in the tree would support `in_tree` on its own, and the page says
so in its status block — but the surface declines to claim it, because the
artifact a rung would cover is going away.

`ampersand-nav` records this surface as `{ place: 2, layer: "runtime", rung:
null }`, and its own `RUNG_LABEL` renders `null` as `?`. So the band prints the
nav's word rather than this repository's opinion of itself, and the divergence
is recorded in `records/surface.json` rather than resolved locally.

## The marketing page is GENERATED

`/index.html`, `/boot.js` and `/say.js` are emitted by `build-site.mjs` from
`records/surface.json`, `records/evidence.json` and `src/`. **An edit to the
served HTML is silently reverted by the next build.**

```bash
npm run site:launch    # emit the page, then prove it
```

`launch-gate.mjs` reads the emitted artifact — and re-derives it from source, so
a build that threw cannot leave a stale page standing behind an approving gate.
It refuses a retracted claim reinstated anywhere (including inside a comment or
an attribute), a rung invented, a CTA the rung has not earned, a hand-typed
count, a cited source line that has stopped saying what it is quoted as saying,
a `mailto:`, a text token below 4.5:1, a button whose colour is decided by a
non-button rule, or an animation constant leaking into the copy. It prints its
own total; **do not hand-type a check count anywhere.**

**Most of what the page claims is negative** — there is no AWS dependency,
nothing reads an `ampersand.json`, `packages/` does not exist. Those are
re-derived off disk on every build, because nobody edits a sentence on a
marketing page when they add a dependency. Nine file probes and a test run are
frozen in `records/evidence.json` and compared on every run.

Cloudflare serves the committed `index.html` and runs no build, so
`npm run site:launch` has to be run **before** committing the page. The build
reads the sibling `ampersand-supabase/` tree (read-only) because that is where
the functions and migrations it cites live.

**Fixed 2026-08-16, and recorded here rather than quietly dropped.** Until that
date the marketing page advertised a **Convex** control plane and sold a
"multi-runtime AI agent deployment platform" deploying to Cloudflare Workers or
AWS Bedrock AgentCore. This repository has never depended on Convex —
`apps/web/package.json` depends on `@supabase/supabase-js`, and the only Convex
entry in any dependency manifest is a `"extraneous": true` record in
`package-lock.json` for `apps/control-plane`, a workspace that no longer exists
on disk. (Convex is still named in `docs/spec/` history and in `old_scrap/`,
where it is either corrected or explicitly historical.) Neither runtime
is wired up either: `ampersand-supabase/functions/webhost-deploy/index.ts`
carries `// TODO: Actual Cloudflare Workers API call goes here` and writes
`simulated: true`, and there is no AWS dependency anywhere. **Those claims were
removed from `index.html` rather than replaced with newer ones**; the page now
states its rung and lists what is and is not built. It is not yet pushed.

**Both of the loose ends from that day are now closed, and one of them moved.**
On 2026-08-16 `app.webhost.systems` served a real React/Supabase build (200,
`index-CBhPWK61.js`) whose compiled-in project URL returned NXDOMAIN — a live
page with no backend. On **2026-08-17 the hostname itself returned NXDOMAIN**:
`getent hosts app.webhost.systems` gives no answer where `webhost.systems` and
`docs.webhost.systems` both resolve. The dashboard has been withdrawn, not
merely orphaned, and the page names that rather than linking it. Separately,
`apps/web/package.json` described itself as "Vite + React + **Clerk**" with no
Clerk dependency anywhere; corrected.

**The old Convex claim reached the root `AGENTS.md` too, and the 2026-08-16
takedown did not get there.** It was still describing a serverless backend, an
auth provider this repository has never depended on, and two directories that
do not exist — so the claims were taken off the page a visitor reads and left
standing in the file every agent reads first. `AGENTS.md` was rewritten on
2026-08-17 and `launch-gate.mjs` now refuses the build if it names that stack
again or cites a path that does not resolve. The `docs/spec/` documents were
corrected earlier.

## Layout

```
index.html          the marketing page served at webhost.systems — GENERATED
boot.js  say.js     its two scripts — GENERATED
src/                the page's template, stylesheet and script sources
records/            the frozen records the page is generated from
build-site.mjs      emits the page; re-derives every count off disk
launch-gate.mjs     reads the artifact and refuses to publish a page that lies
apps/web/           the application — Vite + React + TypeScript, Supabase client
docs/spec/          the v1 specification set (see the supersession note)
amp-nav.js          portfolio nav — DEPLOYED here, not edited here (see below)
old_scrap/          previous versions, historical, not authoritative
```

`package.json` declares npm workspaces at `apps/*` and `packages/*`. There is
currently one workspace, `apps/web`; `packages/` does not exist yet, and the
page build re-checks that on every run.

The edge functions and migrations this product runs on are **not in this
repository** — they are in the sibling `ampersand-supabase/` repo under
`functions/webhost-*` and `migrations/*webhost*`.

## Quick start

```bash
npm install
npm run dev          # Vite dev server for apps/web
npm run typecheck    # tsc --noEmit across workspaces
npm test             # vitest across workspaces
npm run lint
npm run build        # apps/web only — NOT the marketing page
npm run site:launch  # the marketing page: emit it, then prove it
```

**`site:*` is deliberately not wired into `build`, `dev` or `test`.** The
marketing page and `apps/web` are separate artifacts with separate toolchains
and entangling them is how a landing page acquires a bundler it does not need.

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
