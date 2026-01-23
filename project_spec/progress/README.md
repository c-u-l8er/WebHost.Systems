# project_spec/progress — Daily Engineering Progress Logs

This folder contains **daily, append-only engineering progress logs** for the `webhost.systems` implementation effort.

- These logs are **non-normative** (they do not define requirements).
- The **normative spec** remains `project_spec/spec_v1/` (especially `00_MASTER_SPEC.md` and `10_API_CONTRACTS.md`).
- The purpose here is to document **what changed**, **why**, and **what’s next**, day-by-day, in a way that’s easy to audit.

---

## Folder structure

- `progress/README.md` — this index + conventions (you are here)
- `progress/YYYY-MM-DD.md` — one file per day

Recommended: create a new file for each day you do meaningful work, even if it’s short.

---

## Naming convention

Daily logs MUST be named:

- `YYYY-MM-DD.md` (UTC date recommended)

Examples:
- `2026-01-21.md`
- `2026-01-22.md`

---

## Writing rules (conventions)

### 1) Append-only
- Do **not** rewrite history.
- If you need to correct something from a prior day, add a note in today’s log under **Corrections**.

### 2) Traceability and scope
Each daily log SHOULD include:
- What you shipped (high-level)
- Key decisions (with references to ADRs/spec sections)
- Files/dirs touched (short list)
- What’s still missing / follow-ups
- Known issues or risks
- Validation performed (typecheck/tests/manual steps)

### 3) Keep it implementation-focused
This is an engineering log, not a product diary. Prefer:
- “Implemented `/v1/telemetry/report` signature verification and ownership cross-check”  
over
- “Worked on telemetry stuff”

### 4) No secrets
Never include:
- API keys, tokens, real URLs containing secrets, credentials, or private user data.

Use placeholders:
- `https://<deployment>.convex.site`
- `CLOUDFLARE_API_TOKEN=***`

---

## Daily log template

Copy/paste this into a new `YYYY-MM-DD.md` file:

---

# YYYY-MM-DD — Progress Log

## Summary (1–3 bullets)
- …
- …

## Spec/ADR alignment notes
- ✅ Implemented: (reference relevant doc sections)
- ⚠️ Deviations: (explain why; plan to reconcile)
- ❓ Open questions discovered: (link to spec “Open questions” if applicable)

## What shipped today
### Control plane
- …

### Data plane
- …

### Dashboard/UI
- …

## API / Contracts
- Added/changed endpoints:
  - …
- Notes on error envelopes / idempotency / auth:
  - …

## Data model / migrations
- Schema changes:
  - …
- Invariants enforced:
  - …

## Security & secrets
- Telemetry integrity:
  - …
- Secrets handling:
  - …
- Access control / tenant isolation:
  - …

## Observability / billing / limits
- Telemetry ingestion:
  - …
- Aggregation:
  - …
- Limits/gating:
  - …

## Files touched (high-level)
- `...`
- `...`

## Validation performed
- Local run steps:
  - …
- Typecheck/tests:
  - …

## Known issues / risks
- …

## Next steps
- [ ] …
- [ ] …

## Corrections (if needed)
- …

---

## Suggested index section (optional)

If you want this README to also act like an index, keep an “Index” section updated manually:

### Index
- `YYYY-MM-DD.md` — short title

(Keeping it manual is fine; automation can come later if needed.)

---

## Why this exists

This folder supports:
- auditability (“what changed when?”),
- implementation pacing (“are we converging on v1 acceptance criteria?”),
- easier handoffs and reviews.

If a log conflicts with `project_spec/spec_v1/`, the spec wins.