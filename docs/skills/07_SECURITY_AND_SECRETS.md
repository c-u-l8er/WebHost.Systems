# 07 — Security and Secrets

> **Purpose:** Tenant isolation via RLS, encrypted secret storage via Supabase
> Vault, telemetry authentication, abuse prevention, supply chain validation,
> and audit logging requirements.

---

## Tenant Isolation (RLS)

Every table in the control plane database enforces Row-Level Security:

```sql
-- Example: agents table policy
CREATE POLICY "users can only access own agents"
  ON agents
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### RLS Rules

| Table | Policy |
|-------|--------|
| `users` | `auth.uid() = id` |
| `agents` | `auth.uid() = user_id` |
| `deployments` | `auth.uid() = user_id` |
| `metrics_events` | `auth.uid() = user_id` |
| `billing_usage` | `auth.uid() = user_id` |

**Hard rule:** No table is accessible without an RLS policy. If a new table is
added, an RLS policy must be created before any data is inserted.

### Provider Namespace Isolation

Runtime provider resources are namespaced per user:

- Cloudflare: Worker names include user ID prefix
- AgentCore: Runtime resources tagged with user ID

---

## Secrets Handling

### Supabase Vault

Secrets are stored in **Supabase Vault** -- an encrypted key-value store built
into Supabase. The primary database (`agents`, `deployments`, etc.) never
contains plaintext secret values.

```
User adds secret "OPENAI_API_KEY" via dashboard
  -> Value encrypted and stored in Vault (vault.secrets)
  -> agents.env_var_keys = ["OPENAI_API_KEY"] (key name only)
```

### Secret Lifecycle

```
1. User creates secret via UI -> stored in Vault
2. Deploy triggers -> Edge Function reads from Vault
3. Secret pushed to provider mechanism:
   - Cloudflare: Workers Secrets API
   - AgentCore: Environment variable injection / Secrets Manager
4. Vault reference remains; plaintext never logged
```

### Secret Rotation

1. User updates secret value in Vault via dashboard
2. User triggers a re-deploy to push the new value to the provider
3. Old provider secret is overwritten

**Rule:** Never log secret values. Never include secrets in error messages,
telemetry events, or API responses.

---

## Telemetry Authentication

The telemetry ingestion endpoint rejects unauthenticated events. See
`05_TELEMETRY_AND_METRICS.md` for HMAC and JWT details.

Key requirements:

- [ ] Per-deployment signing key generated at deploy time
- [ ] Signing key stored in Vault (not in the deployments table)
- [ ] Anti-replay: timestamp within 5-minute window
- [ ] Attribution verified against deployment records

---

## Abuse Prevention

### Rate Limiting

| Scope | Limit |
|-------|-------|
| Per-user, all agents | N requests/second (configurable) |
| Per-agent | M requests/second (configurable) |
| Payload size | Max 1 MB request body |

### Input Validation

- Reject oversized payloads before parsing
- Validate JSON structure before processing
- Prevent prompt bombing (excessively long message arrays)

### Account-Level

- Disable agent on repeated errors
- Flag accounts with anomalous usage patterns
- Hard-stop on plan limits (see `06_BILLING_AND_LIMITS.md`)

---

## Supply Chain Validation

Uploaded bundles must pass validation before deployment:

| Check | Rule |
|-------|------|
| Size limit | Max compressed size (e.g., 50 MB) |
| File count | Max files (e.g., 10,000) |
| Path traversal | Reject entries with `../` or absolute paths |
| Symlinks | Reject unsafe symlinks |
| Required files | `agent.config.json` + entrypoint must exist |
| Manifest validity | JSON parses, required fields present |

Post-MVP: dependency scanning for known vulnerabilities.

---

## Audit Log

The platform SHOULD maintain an audit log for security-sensitive operations:

| Event | Fields |
|-------|--------|
| Agent created | user_id, agent_id, timestamp |
| Agent disabled | user_id, agent_id, timestamp |
| Deployment created | user_id, agent_id, deployment_id, timestamp |
| Secret created/rotated | user_id, secret_key (not value), timestamp |
| Tier changed | user_id, old_tier, new_tier, timestamp |
| Invocation rejected (limit) | user_id, agent_id, reason, timestamp |

Audit log entries are append-only and retained for at least 90 days regardless
of tier.

---

## Security Checklist

- [ ] RLS policy exists on every table
- [ ] No plaintext secrets in `agents`, `deployments`, or `metrics_events` tables
- [ ] Secrets stored exclusively in Supabase Vault
- [ ] Secret values never appear in logs, errors, or telemetry
- [ ] Telemetry endpoint rejects unauthenticated events
- [ ] Rate limiting is enforced per-user and per-agent
- [ ] Uploaded bundles pass all supply chain validation checks
- [ ] Provider resources are namespaced per user
- [ ] Audit log captures security-sensitive operations
- [ ] New tables require an RLS policy before first use
