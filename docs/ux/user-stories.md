# WebHost.Systems — User Stories

Canonical user-story catalog. Used for Playwright tests + Claude Design input.

**Scope:** Unified operator dashboard aggregating every [&] product's MCP surface. Single sign-on (Supabase), single nav, single theme. Each product is a left-nav section wrapping its MCP tools in task-oriented UI.

**Unit-test surface covered:** `apps/web/src/test/**` (143 tests; currently unit-level only — no e2e layer).

---

## Story 1 · Sign in and land on overview

- **Persona:** Operator returning to the dashboard to check fleet health
- **Goal:** Log in once and see status cards for every [&] product in one glance
- **Prerequisite:** Supabase auth configured; operator has workspace membership
- **Steps:**
  1. Visit `webhost.fly.dev/?page=landing`
  2. Click "Sign in" → Supabase magic link OR OAuth callback
  3. Redirected to `?page=dashboard`
  4. Overview renders status cards: graphonomous-mcp · prism-eval · fleetprompt · etc.
- **Success:** All product cards show up/degraded/down + TTFB; recent activity feed
- **Covers:** `SupabaseAuthProvider`, `WorkspaceProvider`, session persistence, MCP health poller — ~35 unit tests
- **UI status:** auth + landing exist; overview dashboard = stub
- **Claude Design hook:** Status grid (7 product cards + aggregate health pill) + activity feed

## Story 2 · Browse FleetPrompt agents from the nav

- **Persona:** Operator looking for an agent to install
- **Goal:** Click the FleetPrompt section → search → view agent detail
- **Prerequisite:** Operator authed; FleetPrompt MCP reachable
- **Steps:**
  1. Click "FleetPrompt" in left nav
  2. Search box + trust filter visible; type "support"
  3. Agent cards stream in via Supabase Realtime
  4. Click agent → drawer slides in with manifest + trust score + install CTA
- **Success:** Agent detail visible without leaving the dashboard (no full-page nav)
- **Covers:** Nav routing, FleetPrompt MCP client wrapper, realtime subscription
- **UI status:** planned (this is the main Claude Design deliverable)
- **Claude Design hook:** Nav + drawer-based detail panel (matches `current-src/App.tsx` query-param routing)

## Story 3 · Run a PRISM benchmark from the dashboard

- **Persona:** Researcher evaluating a memory system
- **Goal:** Select scenarios + system → start benchmark → watch progress live
- **Prerequisite:** PRISM MCP reachable; scenarios loaded
- **Steps:**
  1. Navigate to "PRISM" section
  2. Pick system (graphonomous) + scenario suite
  3. Click "Run benchmark"
  4. Progress bar + per-scenario status stream in
  5. Completion → leaderboard updates inline
- **Success:** Full compose → interact → observe → diagnose loop, visible in one page
- **Covers:** PRISM MCP client, long-running operation UX, streaming updates
- **UI status:** planned
- **Claude Design hook:** Benchmark runner — system picker · scenario picker · progress panel · leaderboard inline refresh

## Story 4 · Inspect Graphonomous graph state

- **Persona:** Operator troubleshooting why an agent forgot a fact
- **Goal:** Query the graph, see confidence on relevant nodes, run consolidation diagnostic
- **Prerequisite:** Graphonomous MCP reachable
- **Steps:**
  1. Navigate to "Graphonomous" section
  2. Enter query → see `retrieve.context` results as cards (top-k + confidence)
  3. Click "Consolidation diagnostic" → counts before/after hypothetical run
  4. Export trace for RuneFort visualization
- **Success:** Operator diagnoses without leaving the dashboard; link to RuneFort for spatial view
- **Covers:** Graphonomous MCP wrapper, result card render, cross-product deep-link
- **UI status:** planned (strong Claude Design candidate — richest MCP surface)
- **Claude Design hook:** Graph inspector — query box · ranked result cards · "open in RuneFort" button

## Story 5 · Switch workspaces

- **Persona:** Operator serving multiple organizations
- **Goal:** Toggle between workspace A (Acme) and B (Beta Corp) — scope all product views
- **Prerequisite:** User has membership in ≥2 workspaces
- **Steps:**
  1. Click workspace selector in top-right
  2. Pick new workspace
  3. All product sections re-scope immediately (FleetPrompt agents filtered, Delegatic org tree switches, etc.)
- **Success:** Zero-flash workspace context swap; audit event recorded
- **Covers:** `WorkspaceProvider`, session update, MCP client re-auth with new workspace_id
- **UI status:** WorkspaceProvider exists (tested); selector UI planned
- **Claude Design hook:** Top-right workspace picker with recently-used + search

---

**Tests to implement first:** Story 1 (auth landing) already partially covered by `tests/spa/webhost.spec.ts`. Build Story 2 + Story 4 next — they exercise the widest MCP surface per test.
