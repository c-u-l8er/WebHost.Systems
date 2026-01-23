# webhost.systems — Control Plane (Convex) — Slice B

This is the **greenfield v1 control plane** implementation for `webhost.systems`, aligned to `project_spec/spec_v1/`.

Slice B goal: **end-to-end demo flow**:

1. Create agent (authenticated)
2. Deploy agent to **Cloudflare Workers** (immutable deployment record + `activeDeploymentId`)
3. Invoke agent via gateway (non-streaming + SSE “recommended”)
4. Worker emits **signed telemetry** to control plane ingestion endpoint

---

## What’s implemented (Slice B)

### Control-plane components (Convex)
- Convex schema:
  - `users`, `agents`, `deployments`, `metricsEvents`, `billingUsage` (+ optional `subscriptions`, `auditLog`)
- Agent CRUD (HTTP endpoints)
- Deploy orchestration:
  - creates immutable deployment row (`status=deploying`)
  - schedules internal deploy action (Cloudflare API calls happen server-side)
  - on success:
    - deployment `status=active`
    - `agents.activeDeploymentId` updated (routing pointer)
- Invocation gateway:
  - `POST /v1/invoke/:agentId` (non-streaming)
  - `POST /v1/invoke/:agentId/stream` (SSE; currently emulated by buffering one upstream response)
- Telemetry ingestion:
  - `POST /v1/telemetry/report`
  - verifies `X-Telemetry-Signature` HMAC **over raw bytes**
  - cross-checks `{userId, agentId, deploymentId}` ownership against `deployments` (defense in depth)
  - append-only insert into `metricsEvents` with dedupe (`eventId` preferred, `traceId` fallback)

### Data-plane (Cloudflare Worker)
- Deployed worker is a minimal deterministic template:
  - supports `invoke/v1` shape (text-first)
  - echoes last user message
  - emits signed telemetry event best-effort via `waitUntil`

---

## Prerequisites

- Node.js **20+**
- A Convex account
- A Clerk account (JWT template for Convex)
- A Cloudflare account with:
  - Workers enabled
  - An API token that can manage Workers scripts + secrets

---

## Install

From repo root:

```/dev/null/sh#L1-3
npm --prefix WebHost.Systems/apps/control-plane install
```

---

## Configure environment variables

This project relies on environment variables for:
- Convex auth (Clerk)
- Cloudflare deploy/invoke
- Telemetry secret encryption at rest
- Public telemetry ingestion URL

### 1) Convex + Clerk auth

Convex uses `convex/auth.config.ts` and requires:

- `CLERK_JWT_ISSUER_DOMAIN`

You must:
1. In Clerk, create a **JWT template** for Convex (audience / application ID: `"convex"`).
2. Copy the issuer domain (per Convex Clerk auth docs) and set it as `CLERK_JWT_ISSUER_DOMAIN`.

Set `CLERK_JWT_ISSUER_DOMAIN` in:
- your local environment (for `convex dev`)
- the Convex Dashboard (for deployed environments)

### 2) Telemetry secret encryption key (control plane)

Telemetry signing keys are **deployment-scoped** and **must not be stored in plaintext** in Convex.

Set:

- `TELEMETRY_SECRETS_ENCRYPTION_KEY`

Requirements:
- **32 bytes** key material
- Accepted encodings (see `convex/lib/crypto.ts`):
  - base64 / base64url (default)
  - hex via `hex:<...>`

Generate a 32-byte base64 key:

```/dev/null/sh#L1-2
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

### 3) Cloudflare deploy credentials + workers.dev subdomain

Set:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_WORKERS_DEV_SUBDOMAIN`

Notes:
- `CLOUDFLARE_WORKERS_DEV_SUBDOMAIN` is the account subdomain used for `workers.dev` URLs.
  - If workers resolve as `https://<script>.<subdomain>.workers.dev`, set it to `<subdomain>`.

### 4) Telemetry ingestion URL (public)

The deployed Worker needs to POST telemetry to your control plane HTTP endpoint:

- `CONTROL_PLANE_TELEMETRY_REPORT_URL`

This must be a publicly reachable URL to:

- `POST /v1/telemetry/report`

For Convex, HTTP endpoints are served on your deployment’s `*.convex.site` domain.
Once you run `convex dev`, you can determine the dev deployment URL and set:

`CONTROL_PLANE_TELEMETRY_REPORT_URL=https://<your-dev-deployment>.convex.site/v1/telemetry/report`

---

## Run (local development)

### 1) Start Convex dev

```/dev/null/sh#L1-2
cd WebHost.Systems/apps/control-plane
npm run dev
```

This will:
- prompt you to create/link a Convex project (first run)
- set `CONVEX_DEPLOYMENT` locally
- generate `_generated/` code (required for TypeScript types)

### 2) Generate code (optional/manual)

If you need to re-generate types:

```/dev/null/sh#L1-2
cd WebHost.Systems/apps/control-plane
npm run codegen
```

### 3) Typecheck

After you have `_generated/`:

```/dev/null/sh#L1-2
cd WebHost.Systems/apps/control-plane
npm run typecheck
```

---

## HTTP API (Slice B)

All control-plane routes require auth via:

`Authorization: Bearer <Clerk JWT for Convex>`

Telemetry ingestion does **not** use user auth; it uses deployment-scoped signature headers.

### Agents

- `GET /v1/agents`
- `POST /v1/agents`
- `GET /v1/agents/:agentId`
- `PATCH /v1/agents/:agentId`
- `POST /v1/agents/:agentId/disable`
- `DELETE /v1/agents/:agentId`

### Deployments (via agent subroutes)

- `POST /v1/agents/:agentId/deploy`

Payload (Slice B):
- `moduleCode?: string` (optional; if omitted we deploy the built-in worker template)
- `runtimeProvider?: "cloudflare"` (AgentCore not enabled in Slice B)
- `compatibilityDate?: string`
- `invokePath?: string` (default `/invoke`)
- `mainModuleName?: string` (default `index.mjs`)

- `GET /v1/agents/:agentId/deployments`

Query params (optional):
- `limit` (default 50, max 200)
- `status` (`deploying` | `active` | `failed` | `inactive`)
- `includeInactive` (`true` | `false`, default `true`)

Response:
- `{ deployments: Deployment[] }`

- `POST /v1/agents/:agentId/deployments/:deploymentId/activate`

Purpose:
- Rollback / activate a previous deployment by updating the agent’s `activeDeploymentId` (ADR-0005).

### Invoke (gateway)

- `POST /v1/invoke/:agentId`
- `POST /v1/invoke/:agentId/stream` (SSE)

Gateway forwards `invoke/v1` payload to the active deployment.

### Usage & metrics (dashboard support)

- `GET /v1/usage/current`

Returns:
- current UTC billing `periodKey` (v1: `YYYY-MM`)
- current user `tier`
- aggregated usage from `billingUsage` (may be zero until aggregation is implemented)

- `GET /v1/metrics/recent?agentId=...&sinceMs=...&limit=...`

Returns:
- `{ events: MetricsEvent[] }` (recent raw `metricsEvents` for the specified agent, tenant-isolated)

### Telemetry ingestion (data plane → control plane)

- `POST /v1/telemetry/report`

Headers (required):
- `X-Telemetry-Deployment-Id: <deploymentId>`
- `X-Telemetry-Signature: v1=<hex-hmac-sha256(raw_body_bytes)>`

Ingestion verifies:
- signature using the deployment’s secret (stored encrypted-at-rest in Convex)
- deployment ownership and relationship cross-check

---

## Cloudflare Worker expectations (Slice B)

The deployed Worker expects these injected keys (provided by the deploy action via Cloudflare secret bindings):

- `TELEMETRY_SECRET` (base64url of raw key bytes)
- `TELEMETRY_REPORT_URL`
- `USER_ID`
- `AGENT_ID`
- `DEPLOYMENT_ID`
- `RUNTIME_PROVIDER` (should be `"cloudflare"`)

The worker:
- handles `POST <invokePath>` (default `/invoke`)
- emits telemetry best-effort and does not block invocations on telemetry failures

---

## Known limitations (Slice B)

- **Billing/tiers not implemented yet**: tier defaults to `"free"` and runtime gating/limits are not enforced here.
- **Streaming is emulated**: the SSE endpoint buffers one upstream response and emits a single `delta`.
- **No Durable Objects session mapping yet**: session IDs are opaque and not persisted in DO.
- **Cloudflare API integration is minimal**: validate permissions and Cloudflare API schema as you wire real artifacts/bindings.

---

## Next steps (after Slice B)

- Implement write-only secrets API and per-agent secret key metadata enforcement (ADR-0003)
- Add aggregation job for `billingUsage` from `metricsEvents` and request-limit enforcement (ADR-0007)
- Replace inline worker template deploy with artifact pipeline (`agent.config.json` manifest, etc.)
- Add AgentCore provider adapter behind RPI (ADR-0001 / `20_RUNTIME_PROVIDER_INTERFACE.md`)