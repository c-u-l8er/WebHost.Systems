# WebHost.Systems Quickstart

> **Purpose:** Get a local development environment running and deploy your first
> agent in under 10 minutes.

---

## Prerequisites

- Node.js >= 20
- npm (ships with Node)
- Supabase CLI (`npm i -g supabase`)
- A Supabase project (or local emulator)
- Cloudflare account (for data plane testing)

---

## 1. Clone and Install

```bash
git clone <repo-url> WebHost.Systems
cd WebHost.Systems
npm install
```

---

## 2. Environment Setup

Copy the example env and fill in your keys:

```bash
cp .env.example .env.local
```

Required variables:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anonymous key (for client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (for Edge Functions) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (deploy adapter) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Billing webhook verification |

---

## 3. Start Development Servers

```bash
# Terminal 1 -- Vite dev server (dashboard UI)
npm run dev

# Terminal 2 -- Supabase local (if using emulator)
supabase start

# Terminal 3 -- Edge Functions local dev
supabase functions serve
```

---

## 4. Create Your First Agent

### Via the dashboard

1. Navigate to `http://localhost:5173`
2. Sign in (Supabase Auth: email or OAuth)
3. Click "New Agent"
4. Fill in name, framework, and select `cloudflare` runtime
5. Upload a bundle containing `agent.config.json` and your entrypoint
6. Click "Deploy"

### Via the API

```bash
# Authenticate and get a token
TOKEN=$(supabase auth token)

# Create an agent
curl -X POST "$SUPABASE_URL/rest/v1/rpc/create_agent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-first-agent",
    "framework": "custom",
    "runtime_provider": "cloudflare"
  }'
```

---

## 5. Invoke Your Agent

```bash
curl -X POST "$SUPABASE_URL/functions/v1/invoke/$AGENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": { "prompt": "Hello, agent!" }
  }'
```

---

## 6. View Metrics

Navigate to the agent detail page in the dashboard to see:

- Request count
- Token usage
- Compute time (ms)
- Error rate

---

## Next Steps

- Read the [Architecture Overview](architecture.md) for system design context
- See [Skills Reference](skills/SKILLS.md) for operational guides
- Review the [Master Spec](../project_spec/spec_v1/00_MASTER_SPEC.md) for full requirements

---

## Verify Your Setup

```bash
npm run typecheck     # TypeScript check
npm run lint          # ESLint
npm run format:check  # Prettier
```

All three should pass with zero errors before committing.
