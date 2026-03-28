# 02 — Deployment Pipeline

> **Purpose:** How bundles are uploaded, validated, and deployed to runtime
> providers. Covers the immutable deployment model, version monotonicity,
> rollback mechanics, and the AgentCore container build pipeline.

---

## Deployment Model

Deployments are **immutable records**. Once created, a deployment's artifact,
version, and configuration never change. Only `status` and `error_message` are
updated during the lifecycle. Rollback works by switching the agent's
`active_deployment_id` pointer -- not by modifying old deployments.

---

## Deployment Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Immutable deployment identifier |
| `agent_id` | UUID | Parent agent |
| `version` | int | Monotonically increasing per agent |
| `runtime_provider` | enum | `cloudflare` or `agentcore` |
| `status` | enum | `deploying` / `active` / `failed` / `rolled_back` |
| `artifact` | JSONB | Upload reference (checksum, size) |
| `provider_ref` | JSONB | Provider-specific deployment reference |
| `commit_hash` | string? | Optional git commit |
| `error_message` | string? | Failure details (sanitized, no secrets) |

---

## Deploy Flow

```
1. UI uploads bundle (zip/tar)
2. POST /functions/v1/deploy
3. Edge Function:
   a. Validate bundle (see validation rules below)
   b. INSERT deployment (status: deploying)
   c. Call RPI adapter: deploy(artifact, config, secrets)
   d. On success:
      - UPDATE deployment status -> active
      - SET agents.active_deployment_id = deployment.id
      - SET agents.status -> active
   e. On failure:
      - UPDATE deployment status -> failed
      - SET error_message
      - SET agents.status -> error
```

---

## Required Manifest: `agent.config.json`

Every bundle must include this file at the root:

```json
{
  "entrypoint": "src/index.ts",
  "runtime": "cloudflare",
  "protocol": "invoke/v1",
  "env": {
    "requiredKeys": ["OPENAI_API_KEY"],
    "optionalKeys": ["DEBUG"]
  },
  "capabilities": {
    "streaming": true,
    "tools": false
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `entrypoint` | Yes | Path to main file |
| `runtime` | Yes | Must match agent's `runtime_provider` |
| `protocol` | Yes | Must be `invoke/v1` |
| `env.requiredKeys` | Yes | Secret keys that must exist in Vault |
| `capabilities` | Yes | Feature flags |

---

## Validation Rules (MUST)

- [ ] `agent.config.json` exists and parses as valid JSON
- [ ] `entrypoint` file exists in the bundle
- [ ] `runtime` matches the agent's `runtime_provider`
- [ ] `protocol` is `invoke/v1`
- [ ] Bundle size within limits (compressed and extracted)
- [ ] File count within limits
- [ ] No path traversal entries or unsafe symlinks
- [ ] Version is strictly greater than the previous deployment's version

---

## Version Monotonicity

Versions are monotonically increasing integers per agent. The platform
auto-assigns the next version if not provided. Attempting to deploy a version
less than or equal to the current maximum is rejected.

```
agent_id | version | status
---------+---------+--------
abc      | 1       | rolled_back
abc      | 2       | rolled_back
abc      | 3       | active     <-- current
```

---

## Rollback

Rollback does **not** create a new deployment. It switches the active pointer:

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/rollback_deployment" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "agent_id": "<uuid>", "deployment_id": "<target-uuid>" }'
```

The target deployment must have status `active` or `rolled_back` and belong to
the same agent. The current active deployment is marked `rolled_back`.

---

## AgentCore Container Build Pipeline

When `runtime=agentcore`, the control plane converts the uploaded bundle into a
container image:

```
1. Extract and validate archive
2. Build user code (TypeScript -> Node.js 20 artifact)
3. Generate HTTP wrapper (invoke/v1 handler)
4. Build OCI container image
5. Push to ECR registry
6. Create/update AgentCore runtime with image URI
7. Inject env vars (telemetry key + user secrets)
```

The pipeline is idempotent per `deployment_id` -- retries produce the same
provider state.

---

## Concurrent Deploy Guard

Only one deployment can be in `deploying` status per agent at a time. The Edge
Function must check for existing in-progress deployments and reject concurrent
attempts with an appropriate error.

---

## Checklist

- [ ] Bundle includes valid `agent.config.json`
- [ ] Entrypoint file exists
- [ ] Runtime matches agent configuration
- [ ] Version is monotonically increasing
- [ ] Bundle passes size and file count limits
- [ ] No concurrent deploys for the same agent
- [ ] Secrets referenced in manifest exist in Vault
- [ ] Deployment record is immutable after creation (except status/error)
- [ ] AgentCore builds produce deterministic container images
