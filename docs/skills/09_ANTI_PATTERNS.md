# 09 — Anti-Patterns

> **Purpose:** Common mistakes when building, operating, and integrating with
> WebHost.Systems. Each anti-pattern includes the mistake, why it is dangerous,
> and how to do it correctly.

---

## 1. Skipping RLS Policies

**Mistake:** Creating a new table without an RLS policy, or using `service_role`
key in client-side code.

**Why it is dangerous:** Any authenticated user can read or modify other tenants'
data. This is a data breach waiting to happen.

**Correct approach:**
- Add an RLS policy to every table before inserting data.
- Use `anon` or user-scoped JWT on the client; reserve `service_role` for
  Edge Functions only.
- Test RLS by attempting cross-tenant access in integration tests.

---

## 2. Storing Plaintext Secrets in the Database

**Mistake:** Putting API keys or credentials directly in `agents.provider_config`
or `deployments.artifact`.

**Why it is dangerous:** A database leak exposes all customer secrets. RLS does
not protect against a full DB compromise.

**Correct approach:**
- Store secret values exclusively in Supabase Vault.
- Store only key names (not values) in `agents.env_var_keys`.
- Push secrets to provider mechanisms (Cloudflare Secrets API, AWS Secrets
  Manager) at deploy time.

---

## 3. Ignoring Deployment Immutability

**Mistake:** Updating a deployment record's artifact, version, or config after
creation.

**Why it is dangerous:** Breaks audit trail, makes rollbacks unreliable, and can
cause inconsistent state between the DB and the runtime provider.

**Correct approach:**
- Deployments are append-only. Only `status` and `error_message` can be updated.
- To change code or config, create a new deployment.
- Rollback by switching `active_deployment_id`, not by modifying old records.

---

## 4. Allowing Concurrent Deploys

**Mistake:** Not checking for an existing `deploying` status before starting a
new deployment for the same agent.

**Why it is dangerous:** Two concurrent deploys can race on provider state,
leaving the agent in an inconsistent state (e.g., wrong version active).

**Correct approach:**
- Check for `deploying` status on the agent before creating a new deployment.
- Reject concurrent deploy attempts with a clear error message.
- Use database-level locking or a status check in the deploy Edge Function.

---

## 5. Missing Telemetry Authentication

**Mistake:** Accepting telemetry events without verifying the HMAC signature
or JWT.

**Why it is dangerous:** Malicious actors can spoof telemetry to inflate or
deflate usage numbers, affecting billing and observability accuracy.

**Correct approach:**
- Generate a per-deployment HMAC key at deploy time.
- Verify signature and timestamp on every telemetry event.
- Reject events with invalid or expired signatures.

---

## 6. Leaking Secrets in Error Messages

**Mistake:** Including secret values, provider credentials, or internal stack
traces in error responses or telemetry events.

**Why it is dangerous:** Secrets end up in client-visible responses, browser
logs, or monitoring systems.

**Correct approach:**
- Normalize all errors to the standard code set (see `03_INVOCATION_GATEWAY.md`).
- Sanitize error messages before returning to clients.
- Log detailed errors server-side only; return safe messages to clients.

---

## 7. Trusting Client-Provided User IDs

**Mistake:** Accepting `user_id` from the request body instead of extracting it
from the authenticated JWT.

**Why it is dangerous:** Allows privilege escalation -- any user can claim to be
another user.

**Correct approach:**
- Always derive `user_id` from `auth.uid()` (Supabase Auth JWT).
- Never trust client-supplied identity fields for authorization decisions.
- RLS policies enforce this at the database level.

---

## 8. Skipping Bundle Validation

**Mistake:** Deploying uploaded bundles without checking for path traversal,
oversized files, or missing manifest.

**Why it is dangerous:** Path traversal can overwrite system files. Missing
validation leads to runtime failures that are hard to debug.

**Correct approach:**
- Validate every bundle against the full checklist in
  `02_DEPLOYMENT_PIPELINE.md`.
- Reject bundles with `../` paths, unsafe symlinks, or missing
  `agent.config.json`.
- Enforce size and file count limits.

---

## 9. Hard-Coding Tier Limits

**Mistake:** Embedding tier limit values directly in application code instead of
a configuration table.

**Why it is dangerous:** Changing limits requires a code deploy instead of a
config update. Easy to have inconsistent limits across enforcement points.

**Correct approach:**
- Define tier limits in a configuration table or constants file.
- Reference limits from both the invocation gateway and deploy Edge Function.
- Ensure all enforcement points read from the same source of truth.

---

## 10. Forgetting to Emit Telemetry

**Mistake:** Adding a new runtime adapter or code path that does not emit
telemetry events after invocation.

**Why it is dangerous:** Usage goes untracked. Billing is inaccurate. Limits
cannot be enforced. Observability has blind spots.

**Correct approach:**
- Every invocation code path must emit exactly one telemetry event.
- Include telemetry emission in the RPI adapter contract (not optional).
- Test telemetry emission in integration tests.

---

## 11. Using Supabase Edge Functions for Agent Hosting

**Mistake:** Running customer agent code inside Supabase Edge Functions instead
of the data plane (Cloudflare or AgentCore).

**Why it is dangerous:** Edge Functions have runtime limits, different execution
models, and are meant for control plane operations only. Mixing concerns
compromises both reliability and security.

**Correct approach:**
- Edge Functions handle: deploy orchestration, invocation gateway, telemetry
  ingestion, billing webhooks.
- Agent code runs exclusively on Cloudflare Workers/DO or AgentCore.

---

## 12. Circular A2A Delegation

**Mistake:** Not tracking delegation depth in agent-to-agent calls, allowing
Agent A to call Agent B which calls Agent A indefinitely.

**Why it is dangerous:** Infinite loops consume resources and can cause cascading
failures.

**Correct approach:**
- Track `delegation_depth` in every A2A invocation.
- Enforce `max_delegation_depth` from the governance policy.
- Detect and reject circular call chains.

---

## Summary Table

| # | Anti-Pattern | Severity | Fix Reference |
|---|-------------|----------|---------------|
| 1 | Skipping RLS | Critical | `07_SECURITY_AND_SECRETS.md` |
| 2 | Plaintext secrets | Critical | `07_SECURITY_AND_SECRETS.md` |
| 3 | Mutable deployments | High | `02_DEPLOYMENT_PIPELINE.md` |
| 4 | Concurrent deploys | High | `02_DEPLOYMENT_PIPELINE.md` |
| 5 | Unauthenticated telemetry | High | `05_TELEMETRY_AND_METRICS.md` |
| 6 | Secret leaks in errors | High | `03_INVOCATION_GATEWAY.md` |
| 7 | Client-provided user IDs | Critical | `07_SECURITY_AND_SECRETS.md` |
| 8 | Skipping bundle validation | High | `02_DEPLOYMENT_PIPELINE.md` |
| 9 | Hard-coded tier limits | Medium | `06_BILLING_AND_LIMITS.md` |
| 10 | Missing telemetry | High | `05_TELEMETRY_AND_METRICS.md` |
| 11 | Edge Functions as hosting | High | `04_RUNTIME_PROVIDERS.md` |
| 12 | Circular A2A delegation | High | `08_AMPERSAND_INTEGRATION.md` |
