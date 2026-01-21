# ADR-0003: Secrets Handling & Provider Injection Strategy

- **Status:** Accepted
- **Date:** 2026-01-21
- **Owners:** Engineering
- **Related docs:**
  - `WebHost.Systems/project_spec/spec_v1/00_MASTER_SPEC.md`
  - `WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md`
  - `WebHost.Systems/project_spec/spec_v1/20_RUNTIME_PROVIDER_INTERFACE.md`
  - `WebHost.Systems/project_spec/spec_v1/40_SECURITY_SECRETS_COMPLIANCE.md`

## Context

webhost.systems is a multi-runtime AI agent deployment platform with:
- **Control plane:** Auth, dashboard, agent/deployment metadata, billing, limits, metrics aggregation.
- **Data plane:** Executes customer agent code on runtime providers (initially Cloudflare Workers/DO and AWS Bedrock AgentCore).

The platform must handle several categories of secrets:
- **Customer secrets:** model keys (e.g., `OPENAI_API_KEY`), third-party API keys used by agent code.
- **Platform secrets:** Cloudflare API tokens, AWS credentials/roles, billing webhook secret, internal signing keys.
- **Integrity secrets:** telemetry signing keys (deployment-scoped).

Constraints:
- Customer agent code is **untrusted** and may exfiltrate secrets it is given; therefore secrets must be scoped and minimized.
- The platform must support **multiple runtimes**, each with different secret injection mechanisms.
- The platform must enable **telemetry integrity**: data plane must report usage to control plane without allowing spoofing.

Security and operational requirements:
- Minimize blast radius of a control-plane DB read breach.
- Prevent secret leakage via logs, errors, metrics, or UI.
- Support secret rotation with minimal operational burden.
- Keep implementation feasible for MVP while providing a clear path to stronger controls.

## Decision

1. **No plaintext secrets are stored in the primary application database** (Convex).
   - The DB stores only:
     - secret key names (e.g., `envVarKeys`),
     - provider secret references (names/ids),
     - rotation metadata (timestamps, versions),
     - booleans like “is configured”.

2. **Secrets are injected into runtime providers using provider-native secret mechanisms** (where possible).
   - **Cloudflare:** Worker secret bindings (set via Cloudflare API).
   - **AWS / AgentCore:** AWS-native secret mechanisms (e.g., Secrets Manager) or AgentCore-supported secret injection (implementation-specific), referenced by ARN/name—never stored as plaintext.

3. **Telemetry integrity uses deployment-scoped signing keys** injected into the runtime as secrets.
   - Each deployment gets a unique `telemetrySecret` (HMAC key).
   - Data plane signs telemetry payloads with HMAC-SHA256 over raw request bytes.
   - Control plane verifies signature using the secret reference associated with the deployment.

4. **Control plane never exposes secret values back to clients.**
   - A “set secrets” endpoint may exist and is write-only.
   - A “get secrets” endpoint for plaintext MUST NOT exist.
   - The UI can show only:
     - configured keys list,
     - status per key (set/not set),
     - last rotated timestamp (optional).

## Rationale

- **Reduces breach impact:** If the primary DB is compromised, attackers do not automatically obtain usable API keys.
- **Aligns with best practices:** Provider secret stores are purpose-built for secret storage and rotation.
- **Enables multi-runtime:** Provider injection allows per-runtime deployment without inventing a bespoke secret distribution system.
- **Supports telemetry integrity:** Deployment-scoped secrets and HMAC signatures prevent spoofing of usage events, which protects billing and limit enforcement.
- **Keeps MVP achievable:** Write-only secrets entry + provider injection is implementable without building a full secrets vault and policy engine.

## Alternatives considered

### A) Store encrypted secrets in the primary DB (application-managed encryption)
**Pros**
- Simple read/write path.
- Centralized regardless of runtime provider.

**Cons**
- Key management becomes a major responsibility (KMS integration, rotation, access controls).
- If application and DB are compromised, secrets may still be exposed via runtime memory or logs.
- More complex than necessary for MVP given provider secret facilities.

**Decision:** Rejected for v1 (may revisit if a centralized secrets vault is required).

### B) Centralized secret store for all secrets (e.g., dedicated vault) + runtime fetch at execution time
**Pros**
- Single system of record, policy controls, potential audit/compliance benefits.

**Cons**
- Adds significant infrastructure and operational complexity.
- Requires secure runtime access and network paths from every provider.
- Introduces availability coupling: vault outage can break invocations.

**Decision:** Rejected for v1; consider for enterprise roadmap if needed.

### C) Embed secrets in deployment artifacts or config files
**Pros**
- Easiest to implement.

**Cons**
- Catastrophic: secrets leak via artifacts, logs, and provider introspection.
- Violates core security requirement.

**Decision:** Rejected.

### D) Adapter-side telemetry only (no runtime telemetry secret)
**Pros**
- Avoids injecting telemetry secret into runtime.

**Cons**
- Often cannot capture accurate compute/tool usage.
- Harder to attribute reliably at high concurrency; may undercount or miscount.
- Still requires strong integrity controls in adapter pathway.

**Decision:** Not the primary strategy. Allowed only as a constrained fallback if provider limitations require it, but must preserve attribution integrity.

## Consequences

### Positive
- Stronger baseline security posture without heavy infrastructure.
- Clear separation of responsibilities:
  - DB stores metadata and references,
  - providers store values.
- Enables per-deployment telemetry signing and robust anti-spoofing.

### Negative / tradeoffs
- Secret management becomes provider-dependent; implementation must support multiple injection mechanisms.
- Secret rotation may require redeploy on some providers.
- Debugging becomes harder because plaintext is not retrievable; must rely on “configured/not configured” and test invocations.

## Implementation details (normative)

### 1) Data model requirements
- `agents.envVarKeys`: list of secret key names (never values).
- `deployments.telemetryAuthRef`: provider reference to telemetry signing secret (never plaintext).
- Optional `secrets` metadata table (if implemented) stores only:
  - `userId`, `agentId`, `key`, `provider`, `secretRef`, `createdAtMs`, `rotatedAtMs`.

### 2) Secrets write endpoint
If implementing `POST /v1/agents/{agentId}/secrets` (write-only):
- MUST authenticate and enforce tenant ownership.
- MUST validate keys against `agents.envVarKeys` (or allow adding new keys via `agents.update` first).
- MUST store values only in provider secret store(s) and discard plaintext immediately after injection.
- MUST NOT return secret values.
- MUST redact secret values in logs and error messages.

### 3) Provider injection requirements
- Cloudflare adapter:
  - Use provider API to set Worker secrets per deployment or per agent, and ensure the active Worker uses the correct secrets.
- AgentCore adapter:
  - Prefer AWS Secrets Manager references and IAM role-based access; do not embed secrets in code.
  - Store only secret ARNs/names as references.

### 4) Telemetry signing requirements
- Each deployment MUST have a unique telemetry signing secret.
- Runtime sends telemetry with:
  - `X-Telemetry-Deployment-Id: <deploymentId>`
  - `X-Telemetry-Signature: v1=<hex-hmac-sha256(body)>`
- Control plane MUST verify:
  - signature validity,
  - deployment ownership mapping to `{userId, agentId}`,
  - required attribution fields.

### 5) Rotation policy
- Telemetry secrets:
  - MUST rotate on every new deployment by default.
- Customer secrets:
  - MAY be rotated by user action; system SHOULD record rotation timestamp.
  - If provider requires redeploy for new secret values to take effect, UI MUST make this explicit.

## Security & compliance notes

- This ADR supports a SOC2-aligned posture by:
  - minimizing sensitive data stored in primary DB,
  - ensuring integrity of billing-relevant telemetry,
  - enabling auditability (via audit logs for secrets set and telemetry rejections).
- This ADR does not eliminate the inherent risk that untrusted customer agent code can exfiltrate secrets it is given; the platform mitigates by scoping secrets per agent and avoiding cross-tenant exposure.

## Acceptance criteria

This ADR is correctly implemented when:
1. No plaintext secret values exist in the primary DB (verified via code review and automated checks).
2. Secrets set via API are write-only; plaintext secrets are never returned.
3. Provider secrets are injected and required for runtime invocation (e.g., model keys, telemetry signing secret).
4. Telemetry ingestion rejects invalid signatures and mismatched ownership.
5. Logs and error messages are sanitized and do not contain secret values.
6. Secret rotation is supported at least via “set new value” flow and telemetry secrets rotate per deployment.
