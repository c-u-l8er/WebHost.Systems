# 01 — Agent Management

> **Purpose:** How to create, configure, update, disable, and delete agents.
> Covers the agent status state machine, provider configuration, and RLS
> isolation rules.

---

## What Is an Agent?

An **agent** is a logical AI service owned by a single user. It has a selected
runtime provider, configuration, and an optional active deployment. Agents are
the top-level organizational unit in WebHost.Systems.

---

## Agent Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique per user |
| `description` | string | No | Human-readable description |
| `framework` | string | Yes | Informational (e.g., "langchain", "custom") |
| `runtime_provider` | enum | Yes | `cloudflare` or `agentcore` |
| `env_var_keys` | string[] | No | Secret key names (values in Vault) |
| `provider_config` | JSONB | No | Runtime-specific configuration |
| `status` | enum | Auto | Managed by the platform |

---

## Status State Machine

```
                    deploy success
  created -----> deploying ---------> active
     |               |                  |
     |          deploy fail         disable()
     |               |                  |
     |               v                  v
     |             error            disabled
     |               |                  |
     +---------------+--- re-deploy ---+
```

| Status | Meaning | Invocations Allowed |
|--------|---------|---------------------|
| `created` | Agent exists but never deployed | No |
| `deploying` | Deployment in progress | No |
| `active` | Active deployment ready | Yes |
| `error` | Last deployment failed | No |
| `disabled` | Manually disabled by user | No |

**Invariant:** Only `active` agents accept invocations.

---

## CRUD Operations

### Create Agent

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/create_agent" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-agent",
    "framework": "custom",
    "runtime_provider": "cloudflare",
    "env_var_keys": ["OPENAI_API_KEY"]
  }'
```

### Update Agent

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/update_agent" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "agent_id": "<uuid>", "description": "Updated description" }'
```

### List Agents

```bash
curl "$SUPABASE_URL/rest/v1/agents?select=*" \
  -H "Authorization: Bearer $TOKEN"
```

RLS ensures only the authenticated user's agents are returned.

### Disable Agent

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/disable_agent" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "agent_id": "<uuid>" }'
```

Sets status to `disabled`. All invocations will be rejected until re-enabled.

### Delete Agent (Soft)

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/delete_agent" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "agent_id": "<uuid>" }'
```

Soft-deletes the agent. Provider resources should be revoked where possible.

---

## Provider Config

The `provider_config` JSONB field holds runtime-specific settings:

**Cloudflare:**
```json
{
  "worker_name": "agent-<uuid>",
  "durable_object_namespace": "sessions",
  "route_pattern": "agents.example.com/<uuid>/*"
}
```

**AgentCore:**
```json
{
  "runtime_id": "arn:aws:bedrock-agentcore:...",
  "container_port": 8080,
  "idle_timeout_seconds": 300,
  "network_mode": "egress_only"
}
```

---

## RLS Isolation

Every query against the `agents` table is filtered by:

```sql
auth.uid() = user_id
```

- Users can only see, update, and delete their own agents.
- The `user_id` field is set automatically from `auth.uid()` on creation.
- No admin bypass exists in MVP.

---

## Checklist

- [ ] Agent name is unique within the user's namespace
- [ ] `runtime_provider` matches the user's tier (AgentCore requires paid tier)
- [ ] Secret key names in `env_var_keys` have corresponding Vault entries
- [ ] Status transitions follow the state machine (no skipping states)
- [ ] RLS policy is active on the `agents` table
- [ ] Soft-delete revokes provider resources where feasible
