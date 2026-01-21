# ADR-0001: Multi-Runtime Strategy (Cloudflare Workers/DO + AWS Bedrock AgentCore)
Status: Accepted (v1)  
Date: 2026-01-21  
Decision Makers: Engineering  
Related Docs:
- `WebHost.Systems/project_spec/spec_v1/00_MASTER_SPEC.md`
- `WebHost.Systems/project_spec/spec_v1/20_RUNTIME_PROVIDER_INTERFACE.md`
- `WebHost.Systems/project_spec/spec_v1/50_OBSERVABILITY_BILLING_LIMITS.md`
- `WebHost.Systems/project_spec/spec_v1/40_SECURITY_SECRETS_COMPLIANCE.md`

## Context
webhost.systems is a platform for deploying, running, and observing AI agents. The platform must serve two competing needs:

1. **Broad adoption and strong economics** for the majority of users:
   - low marginal cost for invocations,
   - low latency,
   - global availability,
   - simple developer experience.

2. **Enterprise-grade capabilities** for premium customers and advanced workloads:
   - long-running sessions and tasks,
   - stronger isolation and security posture,
   - built-in tool ecosystems (e.g., code interpreter, browser automation) where available,
   - operational maturity and support for compliance-aligned deployments.

No single runtime platform optimizes for all of these simultaneously. In addition, vendor lock-in risk is material: a single-provider architecture can force business and technical constraints (pricing changes, platform limits, region constraints).

We also require:
- a unified invocation protocol across runtimes,
- consistent metering/telemetry and plan enforcement,
- a path to add additional runtimes later without rewriting the control plane.

## Decision
Adopt a **multi-runtime architecture** with a single **control plane** and multiple **data plane** runtime providers behind a shared **Runtime Provider Interface (RPI)**.

### Providers in v1
- **Default runtime**: Cloudflare Workers + Durable Objects (`runtimeProvider = cloudflare`)
  - Target: the majority of workloads and tiers (including free acquisition).
  - Rationale: global edge footprint, strong economics, good latency, suitable for typical agent interactions.

- **Premium/enterprise runtime**: AWS Bedrock AgentCore (`runtimeProvider = agentcore`)
  - Target: enterprise-tier workloads and advanced/long-running tasks.
  - Rationale: enterprise-grade isolation and runtime capabilities; TypeScript ecosystem support exists and can integrate with modern agent tooling.

### Control plane
- The control plane (auth, DB, deployments, billing, telemetry ingestion, aggregation, UI) remains centralized and runtime-agnostic.
- The control plane chooses the provider at deploy time (and routes invocations based on active deployment).

### Contract
- All runtime providers MUST implement the RPI defined in `20_RUNTIME_PROVIDER_INTERFACE.md`, including:
  - `deploy(...)`
  - `invoke(...)` (streaming optional but preferred)
  - telemetry emission strategy and integrity protections
  - normalized error mapping

## Alternatives considered
### A) Single-runtime: Cloudflare-only
**Pros**
- Simplest operational model and implementation.
- Strong edge performance and acquisition economics.

**Cons**
- Hard ceiling on long-running tasks and certain tool ecosystems.
- Weaker enterprise narrative for isolation/compliance and advanced capabilities.
- Constrains future product tiers to one platform’s limitations.

**Why rejected**
Does not meet enterprise/advanced workload requirements without major additional infrastructure.

### B) Single-runtime: AgentCore-only
**Pros**
- Strong enterprise posture and capability set.
- Potentially simpler story for long-running tasks and advanced tools.

**Cons**
- Higher cost structure for broad/free usage; weakens acquisition.
- Region footprint and latency may be weaker for global edge use-cases.
- Increased vendor lock-in risk.

**Why rejected**
Does not meet broad adoption/economics goals; raises lock-in and cost risk for the base tier.

### C) “Use Convex Agents for hosting”
**Pros**
- Extremely fast iteration for control plane and simple assistant-like workflows.
- Unified stack for UI + backend + simple agent logic.

**Cons**
- Not designed as the primary hosting runtime for customer agents at scale.
- Time and execution constraints; mismatched to long-running and high-volume workloads.
- Harder to model durable state and provider-level isolation guarantees for untrusted code.

**Why rejected**
Convex Agents are better suited to control-plane automation (dashboard assistant), not customer agent hosting.

### D) Container/Kubernetes-based runtime as default
**Pros**
- Full control of runtime environment and dependencies.
- Potentially easiest to support arbitrary frameworks.

**Cons**
- Highest operational complexity and ongoing cost.
- Harder to offer a generous free tier with predictable margins.
- Slower time-to-market.

**Why rejected**
Operationally heavy for v1; incompatible with rapid iteration and free-tier economics goals.

## Consequences
### Positive
- **Economic flexibility**: Cloudflare can power free and most paid tiers; AgentCore reserved for premium needs.
- **Product flexibility**: choose best runtime per workload; evolve pricing/tiering by runtime.
- **Risk reduction**: mitigates vendor lock-in through RPI and consistent protocol/telemetry.
- **Future extensibility**: additional providers can be added by implementing the RPI without redesigning the control plane.

### Negative / costs
- **Engineering complexity**: must implement and maintain multiple adapters and consistent semantics.
- **Consistency challenges**: token counting, streaming, and tool semantics vary by provider.
- **Operational surface area**: two providers mean more credentials, monitoring, and failure modes.
- **Telemetry integrity** must be handled carefully to prevent spoofing and cost manipulation.

## Implementation details (normative requirements)
1. **RPI is mandatory**
   - All runtime-specific logic must live behind the RPI.
   - Control plane code must not call provider APIs directly except through the adapter layer.

2. **Invocation protocol is consistent**
   - The canonical request/response shapes are defined in `10_API_CONTRACTS.md` and `00_MASTER_SPEC.md`.
   - Providers may add extra diagnostics internally, but client-facing outputs must be normalized.

3. **Telemetry is required and integrity-protected**
   - Each invocation must produce a telemetry event attributable to `{userId, agentId, deploymentId, runtimeProvider}`.
   - Telemetry ingestion must verify integrity (deployment-scoped signing) and validate ownership.

4. **Tier gating**
   - AgentCore must be gated by tier entitlements (enabled only for premium/enterprise tiers unless explicitly configured otherwise).
   - Both deploy and invoke paths must enforce entitlements (defense in depth).

5. **Secrets handling**
   - No plaintext secrets are stored in the primary DB.
   - Secrets are injected using provider-native secret mechanisms.
   - Telemetry signing secrets are deployment-scoped and injected into the data plane.

6. **Resource tagging**
   - Provider resources should be tagged/labeled with `{userId, agentId, deploymentId}` to support cleanup and future billing reconciliation.

## Operational considerations
- Track per-provider health and error rates independently.
- Implement provider-specific circuit breakers if needed (post-v1).
- Ensure staging environments exist for both providers with separate credentials and billing/webhook settings.

## Success criteria
This decision is successful if:
- Cloudflare deploy/invoke works end-to-end with telemetry and limit enforcement.
- AgentCore deploy/invoke works end-to-end for entitled users with telemetry and limit enforcement.
- Control plane routing remains provider-agnostic and uses only the RPI.
- Adding a new provider would require implementing a new adapter without major changes to the control plane schemas and APIs.

## Follow-ups / next ADRs
- ADR-0002: Control plane backend choice (Convex) and why.
- ADR-0003: Secrets strategy (no plaintext in DB; provider injection).
- ADR-0004: Telemetry integrity model (deployment-scoped signing) and ingestion validation.
- ADR-0005: Deployment immutability + active pointer model.