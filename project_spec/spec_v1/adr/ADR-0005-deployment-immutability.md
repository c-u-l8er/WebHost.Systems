# ADR-0005: Deployment Immutability + Active Deployment Pointer Model

- **Status:** Accepted (v1)
- **Date:** 2026-01-21
- **Owners:** webhost.systems engineering
- **Related docs:**
  - `WebHost.Systems/project_spec/spec_v1/00_MASTER_SPEC.md`
  - `WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md`
  - `WebHost.Systems/project_spec/spec_v1/20_RUNTIME_PROVIDER_INTERFACE.md`
  - `WebHost.Systems/project_spec/spec_v1/30_DATA_MODEL_CONVEX.md`
  - `WebHost.Systems/project_spec/spec_v1/60_TESTING_ACCEPTANCE.md`

## 1) Context

webhost.systems deploys untrusted customer agent code to one of multiple runtime providers and routes invocations to the correct deployed version. The platform must support:

- safe, repeatable deployments,
- rapid iteration with reliable rollbacks,
- clear auditability (“what is running now, and who changed it?”),
- consistent routing across multiple runtime providers,
- robust handling of partial failures (deploy succeeded on provider but DB update failed; or vice versa),
- deterministic metering attribution to `{userId, agentId, deploymentId, runtimeProvider}`.

Early prototypes often store deployment state “in place” on the agent record (e.g., overwriting `workerUrl`, updating `codeHash`, etc.). This tends to create correctness and support problems:

- You lose historical context (“what changed?”).
- Rollback is difficult or impossible without redeploying.
- In-flight deploys can corrupt the “current” state if they fail midway.
- Auditing, debugging, and cost reconciliation become fragile.
- Concurrency introduces race conditions: two deploys can interleave and leave the agent in an inconsistent state.

Therefore, the system needs a durable, auditable, and concurrency-tolerant model for deployments and routing.

## 2) Decision

### 2.1 Deployment immutability

A **Deployment** is an immutable record representing a specific released version of an agent.

- A new deployment attempt MUST create a **new deployment record** (`deployments` table row).
- Deployment records MUST be treated as immutable after creation, except for a narrowly defined mutable subset:
  - `status` (e.g., deploying → active/failed)
  - `providerRef` (filled once known)
  - `errorMessage` (sanitized)
  - timestamps like `deployedAtMs` / `finishedAtMs`
  - optional `logsRef` pointer
- Any new code/artifact/provider configuration change MUST create a new deployment record (never modify an existing deployment to “become” the new version).

### 2.2 Active deployment pointer

Each agent has a single routing pointer:

- `agents.activeDeploymentId` points to the deployment that should receive invocations.
- Rollback (and “activate old deployment”) is implemented by updating `agents.activeDeploymentId` to a previous deployment id.
- Invocation routing uses ONLY:
  - agent ownership checks + status checks, then
  - `activeDeploymentId` → `deployments.providerRef` and `deployments.runtimeProvider` to select runtime adapter and invoke.

### 2.3 Single-writer rule per agent during deploy (v1 simplification)

To reduce complexity and prevent version races in v1:

- The platform MUST prevent concurrent deployments per agent (e.g., guard with `agents.status=deploying` or a server-side mutex mechanism).
- A second deploy attempt while `deploying` SHOULD fail with `CONFLICT` (or be queued post-v1).

## 3) Rationale

### 3.1 Safety and correctness
Immutability avoids a class of “torn writes” where partial updates leave the system in an inconsistent state. If deployment artifacts and references are immutable, you can always answer:
- exactly what was deployed,
- where it was deployed,
- and when it changed.

### 3.2 Rollbacks become fast and reliable
With immutable deployments, rollback is primarily a pointer change:
- no redeploy required (unless provider forces it for technical reasons),
- quick recovery from bad deploys,
- repeatable and auditable.

### 3.3 Auditing and supportability
A permanent deployment history supports:
- customer support (“what changed?”),
- incident response (“who activated what?”),
- compliance-aligned audits.

### 3.4 Metering attribution and future cost reconciliation
When telemetry references a `deploymentId` and deployments are immutable, usage can always be attributed to an exact version and provider resource set. This also enables future provider cost reconciliation by tagging provider resources per deployment.

### 3.5 Multi-runtime routing simplicity
A single `activeDeploymentId` model works uniformly across providers:
- Cloudflare: `providerRef.cloudflare.workerUrl` etc.
- AgentCore: `providerRef.agentcore.agentRuntimeArn` etc.

The control plane remains provider-agnostic; provider-specific details are confined to adapter implementations.

## 4) Alternatives considered

### A) Mutable deployment state stored on the agent row only
**Pros**
- Minimal schema.
- Simplifies “what’s currently active” (single record).

**Cons**
- Loses history.
- Hard to rollback.
- Partial failures can corrupt the running pointer.
- Difficult to audit and debug.
- Makes telemetry attribution ambiguous when “current deployment” changes.

**Decision:** Rejected.

### B) Immutable deployments without an active pointer (derive “active” from latest successful deploy)
**Pros**
- No pointer updates; “active” is last successful deployment.

**Cons**
- Rollback becomes non-trivial (must “fake” a new deploy or add flags).
- “Latest” is not always what you want running (e.g., canary, manual pinning).
- In-flight deploys complicate “latest success” semantics.

**Decision:** Rejected.

### C) Mutable “active deployment” record plus separate immutable history
**Pros**
- A dedicated active record could simplify reads.

**Cons**
- You now have two sources of truth to keep consistent.
- Reintroduces mutability issues for the “active” record.
- Added complexity with limited benefit over a pointer.

**Decision:** Rejected.

### D) Blue/green or canary routing model as default
**Pros**
- Advanced rollout safety.

**Cons**
- Too complex for v1.
- Requires traffic splitting, per-request routing policies, and richer metrics gating.
- Still requires immutable deployments underneath.

**Decision:** Deferred to post-v1; can be built on top of this ADR.

## 5) Consequences

### 5.1 Positive consequences
- Reliable rollback (pointer flip).
- Clear deployment audit trail.
- Strong basis for incident response and debugging.
- Simplified multi-runtime invocation routing.
- Enables deterministic telemetry attribution and later cost reconciliation.

### 5.2 Negative consequences / tradeoffs
- More schema and records (deployments grow over time).
- Requires retention policy decisions for old deployments (storage cleanup, provider resource deprovisioning).
- Requires careful handling of “deploy succeeded but DB update failed” and vice versa.
- Requires a versioning strategy (monotonic per agent) and concurrency controls.

## 6) Implementation details (normative requirements)

### 6.1 Data model requirements
The following fields/semantics MUST exist (names may vary if consistent):
- `deployments` table with:
  - `agentId`, `userId`
  - `version` (monotonic per agent)
  - `runtimeProvider`
  - `artifact` reference (uploaded bundle or repo ref)
  - `providerRef` (runtime-specific invoke reference)
  - `status` and `errorMessage`
  - timestamps (`createdAtMs`, `deployedAtMs`, `finishedAtMs`)
- `agents.activeDeploymentId` pointer to `deployments._id` (nullable)

### 6.2 Immutability enforcement
- Server code MUST NOT update artifact identity fields on `deployments` after creation:
  - `artifact.*`, `manifest.*`, `runtimeProvider`, `version`
- Only the allowed mutable subset may be updated (status/providerRef/error/timestamps/log pointers).
- Client code MUST NOT be allowed to update deployment rows directly.

### 6.3 Activation rules
When activating a deployment (including rollback):
- The target deployment MUST:
  - belong to the agent,
  - belong to the current user (tenant check),
  - be in a valid state for activation (recommended: `status=active`).
- The system MUST update `agents.activeDeploymentId` to the target deployment id.
- The system SHOULD record an audit log entry:
  - `deployment.activate` with `{agentId, deploymentId}` and optional reason.

### 6.4 Routing rules
The invocation gateway MUST route using:
1. resolve agent and enforce ownership (unless public agents exist post-v1),
2. verify agent is not `disabled`/deleted,
3. read `activeDeploymentId`,
4. load deployment by id and verify it belongs to agent and user,
5. route via runtime adapter selected by `deployment.runtimeProvider`,
6. invoke using `deployment.providerRef`.

Routing MUST NOT use “latest deployment” heuristics.

### 6.5 Deploy flow atomicity and failure handling
A deployment flow typically spans multiple systems (DB + provider). The platform MUST handle partial failures.

Minimum v1 requirement:
- The system MUST persist a deployment row with `status=deploying` before making provider calls.
- If provider deployment fails:
  - set deployment `status=failed` and store sanitized `errorMessage`.
  - set agent `status=error` (or keep existing status but expose failure).
- If provider deployment succeeds but DB update fails:
  - the system MUST have a retry mechanism (manual or automated) to reconcile:
    - either re-run the “finalize deploy” step idempotently, or
    - detect orphaned provider resources via tags and mark deployment active later.
- If DB update succeeds but provider deployment later fails (rare but possible due to eventual consistency):
  - system must reconcile on next healthcheck/invoke attempt and mark deployment failed if unusable.

### 6.6 Provider resource tagging (required for cleanup and reconciliation)
All provider resources created for a deployment MUST be tagged/labelled with:
- `userId`
- `agentId`
- `deploymentId`
- `deploymentVersion`
- `runtimeProvider`

### 6.7 Retention and cleanup
- Deployments are retained as part of audit history.
- The platform SHOULD implement:
  - retention policy for old deployments (e.g., keep last N or last X days) per tier,
  - best-effort deprovisioning of provider resources when deployments are deleted or when an agent is deleted.
- Cleanup MUST be careful not to remove resources for the currently active deployment.

## 7) Testing requirements (acceptance-focused)

### 7.1 Unit tests (MUST)
- Deployment status transition validation.
- Immutability enforcement (attempted mutation of immutable fields rejected).
- Activation validation (wrong agent/user/state rejected).
- Routing resolver uses `activeDeploymentId` only.

### 7.2 Integration tests (MUST)
- Deploy creates new immutable record; a second deploy creates a second record.
- Activate (rollback) changes routing immediately.
- Concurrent deploy attempts are rejected with `CONFLICT` (v1).
- Telemetry attribution includes correct `deploymentId`.

### 7.3 E2E tests (MUST)
- Deploy v1 → invoke returns v1 output.
- Deploy v2 → invoke returns v2 output.
- Activate v1 → invoke returns v1 output again.
- Deployment history remains intact and visible.

## 8) Future extensions enabled by this ADR
This model is a foundation for:
- canary/blue-green deployments (multiple “active” pointers with traffic split policies),
- environment promotion (dev → staging → prod) with deployment immutability preserved,
- signed deployment manifests / provenance,
- provider billing reconciliation (resource tags + immutable providerRef),
- more advanced rollback policies (automatic rollback on error rate thresholds).

## 9) Acceptance criteria
This ADR is correctly implemented when:
1. Every deployment attempt creates a new deployment record and does not mutate previous deployments’ immutable fields.
2. An agent’s invocations always route to `activeDeploymentId` (no “latest deploy” routing).
3. Rollback is implemented as an activation/pointer update and takes effect immediately for new invocations.
4. Deployment status transitions are correct and failures do not corrupt the active deployment pointer.
5. Provider resources are tagged with `{userId, agentId, deploymentId}`.
6. E2E tests demonstrate deploy v1 → deploy v2 → rollback to v1 with correct outputs and preserved history.