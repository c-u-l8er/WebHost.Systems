/**
 * webhost.systems — Tier entitlements + limit helpers (v1)
 *
 * Normative sources:
 * - project_spec/spec_v1/adr/ADR-0007-entitlements-and-limits.md
 * - project_spec/spec_v1/50_OBSERVABILITY_BILLING_LIMITS.md
 * - project_spec/spec_v1/10_API_CONTRACTS.md (error semantics)
 *
 * Goals:
 * - Deterministic, server-authoritative mapping from `tier` -> entitlements.
 * - Runtime gating (e.g. AgentCore enabled only for certain tiers).
 * - Limit checking helpers that the invocation gateway and deploy paths can use.
 *
 * Notes:
 * - This module is intentionally pure (no Convex ctx access, no env reads).
 * - Values here are placeholders until pricing is finalized. Keep them conservative and update via
 *   code review (auditable). If you later want runtime-configurable entitlements, replace the
 *   backing map but keep the exported API stable.
 */

export type Tier = "free" | "pro" | "enterprise";

export type RuntimeProvider = "cloudflare" | "agentcore";

export type CoreLimits = {
  /**
   * MUST be enforced pre-invocation (hard-stop) per ADR-0007.
   */
  maxRequestsPerPeriod: number;

  /**
   * v1: enforced post-invocation via telemetry aggregation (block subsequent invocations).
   */
  maxTokensPerPeriod: number;
  maxComputeMsPerPeriod: number;

  /**
   * Optional tool-related quotas (only relevant when tools are enabled).
   */
  maxToolCallsPerPeriod?: number;
  maxCodeExecutionSecondsPerPeriod?: number;
  maxBrowserSessionsPerPeriod?: number;
};

export type RuntimeAccess = {
  agentcoreEnabled: boolean;
};

export type AgentCoreCapabilities = {
  memoryEnabled: boolean;
  codeInterpreterEnabled: boolean;
  browserEnabled: boolean;
};

export type RetentionPolicy = {
  /**
   * Retention for append-only raw telemetry events (`metricsEvents`).
   * The retention job implementation lives elsewhere; this is the policy source of truth.
   */
  rawTelemetryDays: number;

  /**
   * Optional retention for raw logs if/when you store them.
   */
  rawLogsDays: number;
};

export type Entitlements = {
  tier: Tier;
  limits: CoreLimits;
  runtimeAccess: RuntimeAccess;
  agentcore: AgentCoreCapabilities;
  retention: RetentionPolicy;
};

export type UsageTotals = {
  requests: number;
  llmTokens: number;
  computeMs: number;
  toolCalls?: number;
  /**
   * Optional: if you later break out tool usage into separate counters, extend this type.
   */
};

export type LimitType =
  | "requests"
  | "tokens"
  | "computeMs"
  | "toolCalls"
  | "agentcoreEnabled";

export type LimitViolation = {
  type: LimitType;
  /**
   * The configured limit for the user's tier.
   */
  limit: number;
  /**
   * The current observed usage for the period (aggregated, possibly stale).
   */
  current: number;
};

export type LimitCheckResult = {
  ok: boolean;
  violations: LimitViolation[];
};

/**
 * Sentinel for "effectively unlimited" within v1 integer constraints.
 * Avoid `Infinity` to keep JSON and DB interactions sane and to preserve deterministic comparisons.
 */
const UNLIMITED: number = Number.MAX_SAFE_INTEGER;

/**
 * IMPORTANT: These values are placeholders until pricing is finalized.
 *
 * v1 recommendation from ADR-0007:
 * - AgentCore gated off for free.
 * - AgentCore MAY be enabled for pro (tools typically disabled).
 * - AgentCore tools SHOULD be enterprise-only in v1.
 */
const ENTITLEMENTS_BY_TIER: Record<Tier, Entitlements> = {
  free: {
    tier: "free",
    limits: {
      maxRequestsPerPeriod: 1_000,
      maxTokensPerPeriod: 250_000,
      maxComputeMsPerPeriod: 5_000_000,
      maxToolCallsPerPeriod: 0,
      maxCodeExecutionSecondsPerPeriod: 0,
      maxBrowserSessionsPerPeriod: 0,
    },
    runtimeAccess: {
      agentcoreEnabled: false,
    },
    agentcore: {
      memoryEnabled: false,
      codeInterpreterEnabled: false,
      browserEnabled: false,
    },
    retention: {
      rawTelemetryDays: 7,
      rawLogsDays: 3,
    },
  },

  pro: {
    tier: "pro",
    limits: {
      maxRequestsPerPeriod: 25_000,
      maxTokensPerPeriod: 10_000_000,
      maxComputeMsPerPeriod: 250_000_000,
      // Tools disabled by default on pro in v1.
      maxToolCallsPerPeriod: 0,
      maxCodeExecutionSecondsPerPeriod: 0,
      maxBrowserSessionsPerPeriod: 0,
    },
    runtimeAccess: {
      // v1 default: keep off unless you explicitly want AgentCore on pro.
      // Change to `true` when AgentCore is implemented and product allows it.
      agentcoreEnabled: false,
    },
    agentcore: {
      memoryEnabled: false,
      codeInterpreterEnabled: false,
      browserEnabled: false,
    },
    retention: {
      rawTelemetryDays: 30,
      rawLogsDays: 14,
    },
  },

  enterprise: {
    tier: "enterprise",
    limits: {
      // Still bounded in v1 for safety; tune later.
      maxRequestsPerPeriod: UNLIMITED,
      maxTokensPerPeriod: UNLIMITED,
      maxComputeMsPerPeriod: UNLIMITED,
      // Enterprise tools may be enabled; include quotas as safety rails even if "unlimited".
      maxToolCallsPerPeriod: UNLIMITED,
      maxCodeExecutionSecondsPerPeriod: UNLIMITED,
      maxBrowserSessionsPerPeriod: UNLIMITED,
    },
    runtimeAccess: {
      agentcoreEnabled: true,
    },
    agentcore: {
      memoryEnabled: true,
      codeInterpreterEnabled: true,
      browserEnabled: true,
    },
    retention: {
      rawTelemetryDays: 90,
      rawLogsDays: 30,
    },
  },
};

/**
 * Server-authoritative mapping from tier -> entitlements.
 *
 * This must be deterministic and MUST NOT trust client-provided claims.
 */
export function getEntitlementsForTier(tier: Tier): Entitlements {
  const e = ENTITLEMENTS_BY_TIER[tier];
  if (!e) {
    // Defensive; should never happen if `Tier` is correct.
    return cloneEntitlements(ENTITLEMENTS_BY_TIER.free);
  }
  return cloneEntitlements(e);
}

/**
 * Runtime gating (defense in depth).
 *
 * Use this:
 * - on deploy path: reject creating a deployment on AgentCore for non-entitled tiers
 * - on invoke path: reject invocations routed to AgentCore when not entitled
 */
export function isRuntimeProviderAllowed(
  entitlements: Entitlements,
  runtimeProvider: RuntimeProvider,
): boolean {
  if (runtimeProvider === "cloudflare") return true;
  if (runtimeProvider === "agentcore") return entitlements.runtimeAccess.agentcoreEnabled;
  return false;
}

/**
 * Capability gating for AgentCore-specific features.
 *
 * You should call this when:
 * - validating deployment configuration that requests tool/memory features
 * - wiring an AgentCore adapter that might enable tools by configuration
 */
export function assertAgentCoreCapabilitiesAllowed(args: {
  entitlements: Entitlements;
  requested: Partial<AgentCoreCapabilities>;
}): void {
  const { entitlements, requested } = args;

  // If a caller requests a capability, they must be entitled.
  if (requested.memoryEnabled === true && entitlements.agentcore.memoryEnabled !== true) {
    throw new Error("AgentCore memory not enabled for tier");
  }
  if (
    requested.codeInterpreterEnabled === true &&
    entitlements.agentcore.codeInterpreterEnabled !== true
  ) {
    throw new Error("AgentCore code interpreter not enabled for tier");
  }
  if (requested.browserEnabled === true && entitlements.agentcore.browserEnabled !== true) {
    throw new Error("AgentCore browser not enabled for tier");
  }
}

/**
 * Pure limit check against aggregated period usage.
 *
 * v1 enforcement strategy (ADR-0007):
 * - requests MUST be hard-stopped pre-invocation (use this check before provider call)
 * - tokens/compute MAY be enforced based on aggregated usage (stale by telemetry delay);
 *   once exceeded, subsequent invocations should be blocked until period reset or upgrade.
 */
export function checkUsageAgainstEntitlements(args: {
  entitlements: Entitlements;
  usage: UsageTotals;
}): LimitCheckResult {
  const { entitlements, usage } = args;

  const violations: LimitViolation[] = [];

  const requests = toNonNegativeInt(usage.requests);
  const tokens = toNonNegativeInt(usage.llmTokens);
  const computeMs = toNonNegativeInt(usage.computeMs);
  const toolCalls = usage.toolCalls === undefined ? 0 : toNonNegativeInt(usage.toolCalls);

  const { limits } = entitlements;

  if (requests >= toNonNegativeInt(limits.maxRequestsPerPeriod)) {
    violations.push({
      type: "requests",
      limit: toNonNegativeInt(limits.maxRequestsPerPeriod),
      current: requests,
    });
  }

  if (tokens >= toNonNegativeInt(limits.maxTokensPerPeriod)) {
    violations.push({
      type: "tokens",
      limit: toNonNegativeInt(limits.maxTokensPerPeriod),
      current: tokens,
    });
  }

  if (computeMs >= toNonNegativeInt(limits.maxComputeMsPerPeriod)) {
    violations.push({
      type: "computeMs",
      limit: toNonNegativeInt(limits.maxComputeMsPerPeriod),
      current: computeMs,
    });
  }

  // Only enforce tool calls if there is a configured limit and it's > 0.
  // (If tools are disabled, callers should also gate by capabilities.)
  const toolLimit =
    limits.maxToolCallsPerPeriod === undefined ? undefined : toNonNegativeInt(limits.maxToolCallsPerPeriod);

  if (toolLimit !== undefined && toolLimit >= 0 && toolCalls >= toolLimit) {
    violations.push({
      type: "toolCalls",
      limit: toolLimit,
      current: toolCalls,
    });
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Convenience helper for the required v1 hard-stop.
 */
export function wouldExceedRequestsLimit(args: {
  entitlements: Entitlements;
  currentPeriodRequests: number;
  /**
   * Typically 1 per invocation, but keep this general for future batching.
   */
  incomingRequests?: number;
}): { ok: true } | { ok: false; violation: LimitViolation } {
  const { entitlements } = args;
  const current = toNonNegativeInt(args.currentPeriodRequests);
  const incoming = toNonNegativeInt(args.incomingRequests ?? 1);

  const limit = toNonNegativeInt(entitlements.limits.maxRequestsPerPeriod);

  // Block if current is already at/over limit OR this request would cross it.
  if (current >= limit || current + incoming > limit) {
    return {
      ok: false,
      violation: {
        type: "requests",
        limit,
        current,
      },
    };
  }

  return { ok: true };
}

/**
 * Produces a stable "details" object suitable for the normalized error envelope.
 * (The HTTP layer decides the final `code` and status mapping.)
 */
export function buildLimitExceededDetails(args: {
  periodKey: string;
  tier: Tier;
  violation: LimitViolation;
  /**
   * Optional: include runtime info for support/debuggability (safe, non-secret).
   */
  runtimeProvider?: RuntimeProvider;
}): Record<string, unknown> {
  const { periodKey, tier, violation, runtimeProvider } = args;

  return {
    reason: "limit_exceeded",
    periodKey,
    tier,
    limitType: violation.type,
    limit: violation.limit,
    current: violation.current,
    runtimeProvider: runtimeProvider ?? undefined,
    suggestedAction: "upgrade",
  };
}

function cloneEntitlements(e: Entitlements): Entitlements {
  // Explicit clone to prevent accidental mutation of the backing constant map.
  return {
    tier: e.tier,
    limits: { ...e.limits },
    runtimeAccess: { ...e.runtimeAccess },
    agentcore: { ...e.agentcore },
    retention: { ...e.retention },
  };
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const n = Math.trunc(value);
  return n < 0 ? 0 : n;
}
