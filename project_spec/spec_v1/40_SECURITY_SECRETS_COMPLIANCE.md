# webhost.systems — Security, Secrets, and Compliance (v1)
Version: 1.0  
Status: Implementation-ready  
Last updated: 2026-01-21  
Audience: Engineering (primary), Security/Compliance (secondary)

This document defines the **security**, **secrets handling**, and **compliance-aligned** requirements for webhost.systems, including a practical threat model and **acceptance criteria** suitable for implementing from scratch.

Normative language: MUST, MUST NOT, SHOULD, MAY.

---

## 1) Security objectives (what we protect)

### 1.1 Primary assets
The system MUST protect:
- **Tenant data**: agent metadata, deployments, logs/metrics, billing usage, and any stored configuration.
- **Secrets**: API keys (LLM keys), provider credentials, telemetry signing keys, webhook secrets, tokens, session cookies.
- **Runtime integrity**: deployed agent code and its isolation boundaries.
- **Billing integrity**: subscription entitlements, usage counters, and invoicing references.

### 1.2 Security goals
- **Confidentiality**: prevent secret or tenant data disclosure across tenants or to unauthorized parties.
- **Integrity**: prevent unauthorized modification of agents/deployments/usage/billing state; prevent spoofed telemetry and spoofed billing webhooks.
- **Availability**: prevent trivial abuse (prompt bombing, request floods) from degrading service for others; degrade gracefully under load.
- **Auditability**: be able to answer “who did what, when” for privileged control-plane actions.

### 1.3 Security boundaries (explicit)
- **Control plane** (UI + backend + DB): trusted application code; MUST enforce authentication and authorization.
- **Data plane** (runtime providers): executes untrusted customer code; MUST run with least privilege; MUST not be able to read other tenants’ resources.
- **Third parties**: auth provider, billing provider, runtime providers; trust is conditional and verified via signatures/credentials.

---

## 2) Trust model and threat model (practical)

### 2.1 Actors
- **Tenant user (benign)**: uses product normally.
- **Tenant user (malicious)**: attempts to access other tenants’ data or abuse infrastructure.
- **External attacker**: no valid account; attempts to exploit public endpoints, steal data, or degrade service.
- **Compromised third party**: billing webhook spoof, OAuth/session theft, provider credential leak.
- **Insider (future)**: support/admin roles (not in MVP), but spec prepares for auditability.

### 2.2 Attack surfaces (non-exhaustive)
Control plane:
- Auth/session handling (cookies/JWTs)
- Agent/deployment CRUD endpoints
- Invocation gateway
- Secrets management endpoints
- Billing webhook endpoint
- Telemetry ingestion endpoint
- Metrics queries and dashboards (potential PII exposure)
- Artifact upload endpoints (zip/tar parsing, path traversal)

Data plane:
- Cloudflare Worker/DO endpoints
- AgentCore runtime sessions
- Provider APIs used for deployment/secrets injection

Supply chain:
- Build dependencies, artifact content, user-provided code bundles

### 2.3 Threats and required mitigations
This is the minimum threat model for v1.

#### T1: Cross-tenant data access (IDOR)
Risk: attacker changes `agentId` / `deploymentId` and reads/updates other tenant resources.  
Mitigations (MUST):
- Derive `userId` from authenticated identity, never from client input.
- Verify every resource access with `resource.userId == currentUserId`.
- Prefer returning `NOT_FOUND` for unauthorized resource ids to avoid leaking existence.

#### T2: Telemetry spoofing / usage tampering
Risk: attacker fakes telemetry to reduce charges or inflate usage for others.  
Mitigations (MUST):
- Telemetry ingestion MUST require integrity protection (HMAC signature or equivalent).
- Telemetry ingestion MUST cross-check `(userId, agentId, deploymentId)` ownership in DB.
- Telemetry secrets MUST be deployment-scoped and rotated on redeploy.

#### T3: Billing webhook spoofing
Risk: attacker sends fake webhook to grant paid tier.  
Mitigations (MUST):
- Billing webhook endpoint MUST verify provider signature using stored webhook secret.
- Webhook handlers MUST be idempotent and replay-safe.
- Do not accept tier changes from client endpoints.

#### T4: Secret leakage (logs, UI, errors, analytics)
Risk: secrets exposed in logs or returned in responses.  
Mitigations (MUST):
- Never store plaintext secrets in primary DB.
- Never return secret values in responses.
- Redact secrets from logs and error messages.
- Ensure error envelopes do not include raw provider errors that might contain credentials.

#### T5: Compromised runtime workload exfiltrates tenant secrets
Risk: customer agent code reads secrets and exfiltrates them (or uses them unexpectedly).  
Mitigations (MUST/SHOULD):
- Only inject secrets that user explicitly configured for that agent.
- Provide optional outbound egress restrictions post-v1; for v1, document that runtime can make outbound network calls and secrets may be used/exfiltrated by their code.
- Use provider isolation mechanisms (Worker isolates / microVM isolation) and do not share secrets across tenants.

#### T6: Artifact upload vulnerabilities (zip bombs, traversal)
Risk: malicious bundle causes decompression bomb or writes files outside extraction directory.  
Mitigations (MUST):
- Enforce max upload size before extraction.
- Enforce max extracted size and max file count.
- Use safe extraction that prevents `../` traversal and absolute paths.
- Validate required manifest and entrypoint; reject symlinks if not supported.

#### T7: SSRF from control plane to internal resources
Risk: user supplies URLs (GitHub URLs, worker URLs) that cause server to fetch internal endpoints.  
Mitigations (MUST):
- Strict allowlists for any server-side fetch to user-provided URLs.
- For repo refs, only allow `https://github.com/...` (or approved VCS hosts) and validate format.
- Never fetch arbitrary URLs based solely on user input without sanitization/allowlist.

#### T8: Abuse / DoS of invocation gateway
Risk: high request rate or huge payloads.  
Mitigations (MUST/SHOULD):
- Enforce payload size limits.
- Enforce per-user and per-agent rate limits (SHOULD in v1; MUST before public invocations).
- Enforce plan limits early (before provider invocation) to reduce cost exposure.

#### T9: Replay of invocation requests (if public keys introduced)
Risk: reuse of captured requests.  
Mitigations (post-v1 for public invocations):
- Signed requests or API keys with nonce/timestamp, or accept replay as tolerated risk with rate limiting.

---

## 3) Authentication requirements

### 3.1 Identity provider
- Use an external IdP (e.g., Clerk). The control plane MUST treat IdP tokens/cookies as the source of identity.
- The system MUST map IdP identity (e.g., `clerkId`) to internal `users` rows.

### 3.2 Session security
MUST:
- Use HTTPS everywhere.
- Use secure cookie attributes for session cookies (if cookie-based):
  - `Secure`, `HttpOnly`, `SameSite=Lax` (or `Strict` if feasible)
- Protect against CSRF for state-changing endpoints:
  - either use SameSite cookies + CSRF tokens,
  - or use bearer token authorization with CORS restrictions.

SHOULD:
- Short session lifetimes and refresh tokens handled by IdP.
- Device/session revocation support via IdP.

### 3.3 Authorization (tenant isolation)
MUST:
- Every request that touches tenant data MUST have an authenticated user context (except telemetry/billing webhooks which use signatures).
- Every access MUST verify ownership: `resource.userId == currentUserId`.
- Prevent “confused deputy”: ignore any `userId` fields supplied by the client.

---

## 4) Secrets handling (normative)

### 4.1 Core rule
**Plaintext secrets MUST NOT be stored in the primary application database.**

The DB MAY store:
- secret **key names** (e.g., `OPENAI_API_KEY`)
- secret **references** (provider secret name/id, version metadata)
- timestamps and rotation metadata

### 4.2 Secret categories
The system MUST treat these as secrets:
- user-provided model/API keys
- runtime provider credentials used by the platform (Cloudflare API tokens, AWS credentials)
- telemetry signing keys
- billing webhook secrets
- encryption keys (if used)
- API keys for future public invocation

### 4.3 Secret injection (provider-specific)
MUST:
- Inject secrets into the data plane using provider-native secret facilities.
- Ensure secrets are scoped per deployment or per agent (never global across all tenants).

Cloudflare (recommended):
- Use Worker secret bindings (set via Cloudflare API).
- Telemetry secret injected as a Worker secret.

AgentCore (recommended):
- **v1 default:** use **AgentCore Runtime environment variable injection** via the AgentCore Runtime API to inject secrets at deploy/update time (do not store plaintext in the primary DB).
- **optional enhancement:** use **AWS Secrets Manager references** for advanced rotation/governance needs (post-v1 or enterprise hardening).
- Avoid embedding secrets in deployed code artifacts or configuration files.

### 4.4 Secret rotation
MUST:
- Support rotation for platform-owned secrets without downtime where feasible:
  - billing webhook secret rotation (support multiple active secrets during transition)
  - telemetry secret rotation on each deployment (new deployment = new secret)
- Provide a safe path for users to update agent secrets:
  - updating a secret MAY require redeploy; document behavior clearly in UI.

### 4.5 Logging and redaction
MUST:
- Never log request bodies that may contain secrets.
- Redact known secret keys/values in any logs:
  - redact patterns like `sk-...`, `Bearer ...`, `Authorization:` headers, and user-configured env var keys.
- Ensure error responses do not include secrets.

### 4.6 Access controls for secrets endpoints
MUST:
- Secrets write endpoints are authenticated and tenant-authorized.
- Secrets read endpoints MUST NOT exist for plaintext secrets. (If you need “verify configured”, expose booleans only: `isSet`.)

### 4.7 Encryption at rest / in transit
MUST:
- TLS for all traffic between clients and control plane.
- TLS for all traffic from data plane telemetry to control plane.
- Rely on managed provider encryption-at-rest for databases and secret stores (acceptable for v1).

SHOULD:
- If storing any sensitive-but-not-secret data, encrypt at rest using managed KMS where available.

---

## 5) Telemetry security (data plane → control plane)

### 5.1 Integrity and authenticity
MUST:
- Telemetry ingestion MUST verify authenticity and integrity of telemetry events.
- Use deployment-scoped signing:
  - Each deployment has a `telemetrySecret` injected into the runtime.
  - Telemetry payload is signed using HMAC-SHA256 over the raw request body.
  - Include deployment id header to select correct secret reference.

### 5.2 Anti-replay (recommended)
SHOULD:
- Include `timestamp` in telemetry body and reject events older than a window (e.g., > 1 hour) unless there is a backlog mode.
- Optionally include a unique `eventId` and store a dedupe record for a short window to prevent replay. (May be deferred to post-v1 if ingestion endpoint is not public.)

### 5.3 Ownership cross-check
MUST:
- After signature verification, cross-check:
  - `deploymentId` belongs to `agentId`
  - `agentId` belongs to `userId`
- If mismatch, reject and write an audit record (sanitized).

### 5.4 Least privilege
MUST:
- Telemetry endpoint MUST not accept session cookies for authentication.
- Telemetry endpoint MUST not allow querying or mutating tenant data; it only ingests events.

---

## 6) Billing and entitlement security

### 6.1 Billing webhook verification
MUST:
- Verify billing provider signature on every webhook request.
- Reject unsigned/invalid webhooks with `UNAUTHENTICATED`.
- Webhook handler MUST be idempotent:
  - if the same event arrives multiple times, it must not cause inconsistent tier state.

### 6.2 Entitlement source of truth
MUST:
- Tier/entitlements are derived from:
  - subscription record maintained by webhooks (primary), and/or
  - a server-side entitlement table
- Clients MUST NOT be able to set tier/entitlements directly.

### 6.3 Abuse prevention
SHOULD:
- On suspected fraud or abuse, allow server-side disabling of an account (`users.disabled=true`), rejecting deploy/invoke.

---

## 7) Artifact and build security

### 7.1 Upload validation
MUST:
- Enforce max upload size (bytes).
- Enforce max extracted size (bytes) and max file count.
- Reject archives containing:
  - absolute paths,
  - path traversal (`../`),
  - symlinks (recommended to reject in v1),
  - device files or special file types.

### 7.2 Manifest validation
MUST:
- Require `agent.config.json` (or equivalent manifest).
- Validate manifest fields:
  - protocol version must be supported (e.g., `invoke/v1`)
  - runtime must match selected runtime provider
  - required env keys declared
- If invalid: reject with `INVALID_REQUEST` and safe error message.

### 7.3 Dependency and code risks (documented)
MVP stance (acceptable):
- Do not run full SAST/DAST/SCA in v1.
- Document to users that they are responsible for their agent code security.
- Provide future roadmap for scans.

SHOULD:
- Provide optional allowlist/denylist for packages or forbidden APIs in post-v1.

---

## 8) Data handling, privacy, and compliance posture (v1)

### 8.1 Data classification
Define three categories:
1. **Public**: marketing site content, docs.
2. **Customer metadata**: agent names, descriptions, deployment timestamps, usage aggregates.
3. **Sensitive**:
   - secrets (highest)
   - invocation payloads and logs may contain PII depending on user usage
   - support communications

### 8.2 Minimization
MUST:
- Do not store invocation request/response content by default unless explicitly enabled.
- Telemetry events should include counts and timing, not full prompt contents.
- Logs should avoid capturing user prompts unless necessary for debugging and explicitly configured.

### 8.3 Retention
MUST:
- Implement retention policies for logs and raw telemetry events (tier-based).
- Allow user-initiated deletion of agents; ensure new invocations are blocked immediately.

SHOULD:
- Provide “delete account” workflow post-v1.

### 8.4 Compliance targets (roadmap-aligned, not certified in v1)
v1 should be **SOC2-aligned** in design (controls-friendly), but not necessarily certified.
MUST (baseline controls-friendly behavior):
- audit logs for privileged actions
- least privilege and segregation of duties principles in code
- secrets management policies (no plaintext in DB)
- secure webhook verification
- documented retention policies

---

## 9) Operational security

### 9.1 Least privilege for platform credentials
MUST:
- Cloudflare API token used by control plane:
  - scoped to only the necessary account and operations (deploy, secrets set, DO namespace, etc.)
- AWS credentials:
  - scoped to only AgentCore and any required secret mechanisms
  - use IAM roles with minimum permissions

### 9.2 Environment separation
SHOULD:
- Separate dev/staging/prod environments with different credentials and isolated data.
- Prevent staging credentials from accessing prod resources.

### 9.3 Incident response hooks (v1 minimal)
SHOULD:
- Provide a way to:
  - disable a user account quickly,
  - revoke or rotate platform credentials,
  - invalidate sessions (via IdP),
  - inspect audit logs for suspicious activity.

---

## 10) Security acceptance criteria (Definition of Done)

The system meets v1 security requirements when all statements below are true.

### 10.1 Tenant isolation
- [ ] Every control-plane endpoint derives `userId` from auth and enforces `resource.userId == currentUserId`.
- [ ] Attempts to access another tenant’s agent/deployment/metrics return `NOT_FOUND` (preferred) or `UNAUTHORIZED` consistently.
- [ ] No endpoint trusts client-provided `userId` for authorization.

### 10.2 Secrets
- [ ] No plaintext secret values are stored in the primary database (verified by code review and/or automated checks).
- [ ] Secrets write endpoint exists (optional), but there is no plaintext secrets read endpoint.
- [ ] Error messages and logs do not include secret values; known patterns are redacted.
- [ ] Telemetry signing key is injected into runtime as a secret and never returned to client.

### 10.3 Telemetry integrity
- [ ] Telemetry ingestion rejects requests with invalid signatures.
- [ ] Telemetry ingestion cross-checks ownership and rejects mismatches.
- [ ] A malicious tenant cannot submit telemetry for another tenant’s deployment.

### 10.4 Billing integrity
- [ ] Billing webhooks verify signature and are replay/idempotency safe.
- [ ] Client cannot directly upgrade tier without a verified webhook event.
- [ ] Entitlements are enforced on deploy and invoke paths.

### 10.5 Artifact safety
- [ ] Upload/extraction rejects path traversal and enforces size/file count limits.
- [ ] Invalid manifests are rejected with `INVALID_REQUEST`.
- [ ] Upload flow cannot write files outside extraction directory.

### 10.6 Transport and session security
- [ ] Control plane endpoints require HTTPS in production.
- [ ] Session cookies (if used) are `Secure` and `HttpOnly`.
- [ ] State-changing endpoints have CSRF protection (SameSite + CSRF token or equivalent).

### 10.7 Auditing
- [ ] Deployments, tier changes, secrets updates, and telemetry rejections produce audit log entries (sanitized).
- [ ] Audit logs contain sufficient metadata to trace actions by `traceId` and `actorUserId`.

---

## 11) Security testing checklist (v1)
MUST have tests or manual verification for:
- IDOR attempts across all CRUD endpoints (agents, deployments, metrics)
- telemetry signature validation
- webhook signature validation
- payload size limits on invoke and telemetry
- redaction of secrets in logs/errors

SHOULD:
- basic fuzz testing for archive extraction
- load test invocation gateway with limit enforcement enabled
- verify rate limiting behavior (if implemented)

---

## 12) Future hardening (post-v1)
- Public agents via API keys: add nonce/timestamp signing and per-key rate limits
- Egress controls for runtimes (restrict outbound domains)
- SCA/SAST scanning for uploaded artifacts and dependencies
- Provider billing export reconciliation for accurate cost accounting
- Advanced abuse detection and automated account quarantining
- SOC2 certification program (policies, evidence, control mapping)

---