# ADR-0007: Tier Entitlements, Runtime Gating, and Limit Enforcement Strategy
Status: Accepted (v1)  
Date: 2026-01-21  
Decision Makers: Engineering  
Related Docs:
- `WebHost.Systems/project_spec/spec_v1/00_MASTER_SPEC.md`
- `WebHost.Systems/project_spec/spec_v1/10_API_CONTRACTS.md`
- `WebHost.Systems/project_spec/spec_v1/20_RUNTIME_PROVIDER_INTERFACE.md`
- `WebHost.Systems/project_spec/spec_v1/30_DATA_MODEL_CONVEX.md`
- `WebHost.Systems/project_spec/spec_v1/40_SECURITY_SECRETS_COMPLIANCE.md`
- `WebHost.Systems/project_spec/spec_v1/50_OBSERVABILITY_BILLING_LIMITS.md`
- `WebHost.Systems/project_spec/spec_v1/60_TESTING_ACCEPTANCE.md`

## 1) Context

webhost.systems is a multi-runtime AI agent platform. The control plane must:
- monetize via subscription tiers,
- enforce tenant entitlements and limits in a way that protects platform cost exposure,
- gate access to premium runtime providers (AWS Bedrock AgentCore),
- provide predictable, explainable behavior to users and support.

The platform has heterogeneous cost profiles by runtime:
- **Cloudflare Workers/DO** supports a broad set of use cases with favorable economics and global edge distribution, enabling acquisition tiers (including free).
  - TypeScript-first: Workers/DO are TypeScript-friendly and support modern agent frameworks naturally.
- **AWS Bedrock AgentCore** supports premium enterprise capabilities (long running sessions, stronger isolation, built-in tools), but has higher marginal cost and different operational constraints.
  - TypeScript-first: AgentCore has first-class TypeScript SDK support for runtime operations and modern tooling integration:
    - `@aws-sdk/client-bedrock-agentcore` (TypeScript) for management and invocation
    - `bedrock-agentcore` (TypeScript) for built-in tools (e.g., Code Interpreter and Browser), with integration paths for modern agent frameworks (e.g., Vercel AI SDK)
  - Premium value drivers beyond runtime length:
    - built-in tool ecosystem (code execution + browser automation) that is otherwise “DIY” on many runtimes
    - enterprise isolation posture aligned with higher-tier requirements

Limits are required for:
- preventing runaway cost and abuse,
- ensuring fairness and QoS,
- aligning tier pricing with usage.

Key constraints:
- Actual token usage and compute time are not known until after the invocation completes.
- Telemetry ingestion is asynchronous and may be delayed or fail transiently.
- Concurrency (multiple simultaneous invocations) can race around limit boundaries.
- Security requirements prohibit relying on client-provided usage or tier claims.

Therefore, v1 needs a robust entitlement model and a limit enforcement strategy that is safe, implementable, and extensible.

## 2) Decision

### 2.1 Adopt a configuration-driven entitlement model (server authoritative)

Entitlements are represented as a server-side configuration mapping a user’s current tier to a set of allowed capabilities and budgets. Entitlements MUST be treated as **authoritative** on the server; the client/UI is advisory only.

Each tier defines (minimum):
- `maxRequestsPerPeriod`
- `maxTokensPerPeriod` (reported or estimated)
- `maxComputeMsPerPeriod`

Runtime access + capabilities:
- `agentcoreEnabled` (boolean) — whether the user may deploy/invoke on AgentCore at all
- `memoryEnabled` (boolean) — whether AgentCore Memory features may be enabled for deployments
- `codeInterpreterEnabled` (boolean) — whether AgentCore Code Interpreter tools may be enabled for deployments
- `browserEnabled` (boolean) — whether AgentCore Browser tools may be enabled for deployments

Tool quotas (only meaningful if tools are enabled; omitted or set to 0 when disabled):
- `maxToolCallsPerPeriod` (number, optional)
- `maxCodeExecutionSecondsPerPeriod` (number, optional)
- `maxBrowserSessionsPerPeriod` (number, optional)

Retention policies:
- telemetry/logs retention days

Entitlements MUST be stored and evaluated in a way that can be changed without code edits (e.g., configuration file/env, DB table, or feature flag system). Exact storage choice is implementation detail, but it MUST be server-controlled and auditable.

### 2.2 Tier gating rules: runtime access is an entitlement (defense in depth)

Runtime access is gated by entitlements:

- If `agentcoreEnabled=false`, then:
  - deploy to `runtimeProvider=agentcore` MUST be rejected, and
  - invoke routed to an AgentCore deployment MUST be rejected, and
  - any attempt to switch an agent’s runtimeProvider to `agentcore` SHOULD be rejected (v1 recommendation: reject to reduce confusion).

- If `agentcoreEnabled=true`, AgentCore capability flags MUST still be enforced:
  - If `codeInterpreterEnabled=false`, deployments MUST NOT enable code interpreter tooling, and invocations MUST be treated as “tools unavailable” (no tool loop) even if user code requests it.
  - If `browserEnabled=false`, deployments MUST NOT enable browser tooling, and invocations MUST be treated as “tools unavailable” for browser interactions.
  - If `memoryEnabled=false`, deployments MUST NOT enable provider memory features.

**v1 recommendation (tools): enterprise-only**
- v1 SHOULD enable AgentCore tools (`codeInterpreterEnabled` and `browserEnabled`) only on the `enterprise` tier.
- v1 MAY allow `agentcoreEnabled=true` on `pro` while keeping tools disabled (and optionally allowing `memoryEnabled=true` if cost/behavior is acceptable).
- If you later enable tools for `pro`, you MUST add explicit tool quotas (`maxToolCallsPerPeriod`, `maxCodeExecutionSecondsPerPeriod`, `maxBrowserSessionsPerPeriod`) and enforce them at invoke time.

This gating MUST be enforced at three layers (defense in depth):
1. **UI layer**: hide/disable options (non-authoritative)
2. **Control plane deploy/invoke APIs**: authoritative check before provider calls
3. **Runtime adapter layer**: refuse deploy/invoke if not entitled (in case of misrouting or bugs)

The same three-layer enforcement applies to **AgentCore capability flags** (`memoryEnabled`, `codeInterpreterEnabled`, `browserEnabled`):
- UI MUST not present toggles the user is not entitled to.
- Deploy APIs MUST reject configurations that attempt to enable disallowed capabilities.
- Invoke routing MUST ensure a deployment cannot exercise disallowed capabilities (even if user code attempts to).

### 2.3 Limit enforcement strategy (v1): requests hard-stop + post-charge tokens/compute, with upgrade path to reservation

v1 enforcement strategy is:
- **Pre-invocation hard-stop on requests** (MUST).
- **Post-invocation accounting for tokens/compute** via telemetry (MUST).
- **Subsequent invocations blocked** if tokens/compute budgets exceeded (MUST).
- **Optional predictive reservation** for expensive runtimes (SHOULD for AgentCore, MAY for Cloudflare) as an enhancement.
  - AgentCore-specific note: because AgentCore can support longer-running workloads and built-in tools (code execution, browser automation), it may concentrate more cost into a single invocation. This makes reservation (or stricter pre-flight checks) more valuable for AgentCore tiers.

This is a deliberate v1 tradeoff:
- It protects the platform from request floods (and thus most cost/abuse).
- It keeps implementation complexity manageable while still meeting product needs.
- It provides a clear path to a stronger pre-reservation model without changing the external API.

### 2.4 Enforcement point: invocation gateway is the primary cost-control boundary

Limits MUST be enforced in the invocation gateway **before calling a runtime provider** whenever possible. This prevents spending money on requests that will be rejected.

For v1:
- Request count enforcement MUST happen before provider invocation.
- Token/compute enforcement MAY lag by up to telemetry ingestion delay; when exceeded, block subsequent requests.

### 2.5 Consistent error semantics

When a deploy or invoke is rejected due to entitlements or limits, the system MUST return a normalized error envelope with:
- `code = LIMIT_EXCEEDED` (or a dedicated entitlement code if added later),
- a safe user-displayable message,
- details including:
  - limit type (`requests`, `tokens`, `computeMs`, or `agentcoreEnabled` / `runtimeGated`),
  - period key,
  - current usage and limit where known,
  - suggested action (upgrade tier).

HTTP status mapping is defined in `10_API_CONTRACTS.md`.

## 3) Rationale

### 3.1 Why configuration-driven entitlements
- Pricing and tiers will iterate frequently; hardcoding makes iteration risky and slow.
- Entitlements must be authoritative and auditable, independent of client behavior.
- A single entitlements surface simplifies UI gating, API checks, and support tooling.

### 3.2 Why runtime gating is mandatory
- AgentCore has a materially different cost and capability footprint.
  - Capability: long-running sessions and built-in tools (e.g., code execution and browser automation) unlock workflows that are not “free” to operate.
  - DX: AgentCore is viable for TypeScript-first teams via official TypeScript SDK support and tool integrations, which strengthens its premium value proposition.
- Allowing access without gating risks unbounded cost exposure, especially for long-running or tool-heavy workloads.
- Tier-based runtime gating enables a clear product ladder (acquisition → premium) while keeping the default path cost-efficient and globally distributed.

### 3.3 Why requests-first enforcement is acceptable for v1
- Requests are the most immediate and reliable pre-invocation signal.
- Accurate tokens/compute budgets require predictive reservation or “post-charge” logic, which is more complex and varies by runtime.
- v1 still ensures tokens/compute budgets are enforced over time (subsequent blocking), which is sufficient to prevent ongoing overuse.

### 3.4 Why we still plan for reservation
For AgentCore, a single invocation can be expensive. Reservation provides better pre-flight protection:
- reserve predicted tokens/compute,
- reject if budget cannot cover expected cost,
- reconcile after invocation.

We accept requests-first in v1 but design data models and APIs to allow reservation without breaking changes (e.g., counters and “pending usage” concepts).

## 4) Alternatives considered

### A) No limits (reject)
Pros:
- simplest experience

Cons:
- unacceptable cost and abuse exposure
- no pricing integrity
Rejected.

### B) Pre-reservation for all dimensions in v1 (defer)
Pros:
- best cost control and fewer “single request blows budget” events

Cons:
- requires good prediction of tokens/compute, which is inherently uncertain
- requires stronger atomic counters and reconciliation logic
- increases complexity and time-to-market
Deferred; recommended as a post-v1 enhancement, and potentially as a “AgentCore-only” enhancement sooner.

### C) Provider-side enforcement only (reject)
Pros:
- offload to providers

Cons:
- providers don’t enforce webhost.systems tier semantics
- cannot unify multi-runtime behavior
- cannot prevent cross-runtime abuse and cannot provide unified UX
Rejected.

### D) Soft limits with overage billing from day one (defer)
Pros:
- better UX (fewer blocks), potential revenue upside

Cons:
- requires accurate reconciliation, payment handling, dispute workflows
- increases complexity and compliance surface
Deferred; start with hard-stop in v1.

## 5) Consequences

### Positive
- Clear, predictable tier behavior.
- Strong control of premium runtime access.
- Requests hard-stop prevents the most common abuse patterns.
- Compatible with future improvements (reservation, overages, public invocations).

### Negative / tradeoffs
- A user may exceed token/compute budget within a single request in v1 (especially on premium runtime), then be blocked afterwards.
- Telemetry delays can cause temporary undercounting until aggregation catches up.
- Concurrency can cause minor overrun near boundaries unless atomic counters are implemented.

## 6) Implementation details (normative requirements)

### 6.1 Entitlements representation
The system MUST have a function (or module) equivalent to:

- `getEntitlementsForTier(tier) -> { limits, runtimeAccess, retention }`

It MUST be deterministic, server-only, and auditable (config changes tracked via code review or admin change logs).

### 6.2 Period definition
v1 MUST standardize billing periods. Recommendation:
- calendar-month `YYYY-MM` as `periodKey`

If subscription-aligned periods are implemented later, ensure backward compatibility in reporting.

### 6.3 Invocation enforcement algorithm (v1)
At invocation start (before provider call):
1. Resolve authenticated user.
2. Resolve agent; enforce ownership; ensure not disabled/deleted.
3. Resolve active deployment; ensure valid state.
4. Load entitlements for user tier.
5. Enforce runtime gating:
   - if deployment runtime is `agentcore` and `agentcoreEnabled=false`, reject.
6. Load current period usage totals (from aggregated `billingUsage` and/or fast counters).
7. Enforce requests limit:
   - if requests already at/over limit, reject with `LIMIT_EXCEEDED`.
8. Proceed to provider invocation.

After invocation:
- Ensure telemetry is recorded (directly from runtime or adapter-side).
- Aggregation updates period totals.
- If tokens/compute exceed budgets:
  - subsequent invocations MUST be rejected until next period or upgrade.

### 6.4 Deploy-time enforcement
At deploy start:
- Load entitlements.
- Enforce runtime gating (AgentCore enabled).
- Enforce any deploy-related caps (optional in v1; e.g., max agents or deployments).
- Create deployment record and proceed.

### 6.5 Concurrency and counters (minimum vs recommended)
Minimum acceptable v1:
- Use aggregated usage totals and accept small overruns under concurrency.
- Ensure the system never systematically undercounts.

Recommended:
- Maintain an atomic per-user per-period counter for `requests`.
- Optionally maintain token/compute counters as well.
- If counters are implemented, ensure idempotency under retries and telemetry dedupe.

### 6.6 Telemetry integrity dependency
This ADR depends on ADR-0004 (telemetry integrity). Limit enforcement based on usage requires trustworthy telemetry:
- signed events per deployment,
- ownership cross-check.

### 6.7 Observability and UX requirements
When rejecting for limits/gating:
- include enough detail to explain why,
- suggest an upgrade path,
- never leak confidential internal state.

The dashboard MUST show:
- current tier and limits,
- current usage totals,
- per-runtime breakdown,
- “estimated” cost labeling.

## 7) Testing requirements (acceptance-focused)

### MUST
- E2E: requests limit blocks invocations with `LIMIT_EXCEEDED`.
- Integration: AgentCore deploy/invoke blocked for non-entitled tiers.
- Unit: entitlements mapping returns expected limits and gating behavior.
- Integration: deploy-time gating prevents provider calls to AgentCore.
- Security: clients cannot modify tier or entitlements; only webhook-verified updates are effective.

### SHOULD
- Concurrency test near request limit boundary.
- Token/compute exceeded triggers subsequent blocking.
- Telemetry delays do not break correctness beyond acceptable staleness windows.

## 8) Acceptance criteria

This ADR is correctly implemented when:

1. **Authoritative entitlements**
   - The server derives tier entitlements from a server-controlled configuration and does not trust client claims.

2. **Runtime gating**
   - Users without `agentcoreEnabled` cannot deploy to AgentCore and cannot invoke AgentCore deployments (defense in depth).

3. **Limit enforcement**
   - Requests limit is enforced pre-invocation (hard-stop).
   - Tokens/compute are accounted post-invocation and cause subsequent blocking when exceeded.

4. **Consistent errors**
   - All limit/gating rejections return normalized error envelopes with actionable details.

5. **Billing integrity**
   - Tier changes occur only via verified billing webhooks (or an equivalent server-only mechanism) and cannot be spoofed by clients.

6. **Observability**
   - Dashboard shows current period usage and limits, including per-runtime breakdown, with cost labeled as estimated.

7. **Extensibility**
   - The architecture can be upgraded to predictive reservation and/or overage billing without breaking API contracts.
