import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  getEntitlementsForTier,
  isRuntimeProviderAllowed,
  type RuntimeProvider,
  type Tier,
} from "../lib/entitlements";

/**
 * Internal invocation authorization + request reservation (v1).
 *
 * Normative source:
 * - ADR-0007 (requests hard-stop pre-invocation; premium runtime gating)
 *
 * Purpose:
 * - Validate that `{userId, agentId, deploymentId}` are consistent and invokable.
 * - Enforce tier-based runtime gating (defense in depth).
 * - Reserve (increment) exactly one request for the current billing period BEFORE calling the runtime.
 *
 * Data model notes:
 * - Uses `requestUsageCounters` as the fast path for pre-invocation request-limit enforcement.
 * - `billingUsage` remains derived from telemetry (`metricsEvents`) and should not be mutated here.
 *
 * Idempotency note:
 * - This reservation is NOT idempotent by `traceId` in v1.
 * - If you need idempotency for retries, add a `requestReservations` table keyed by
 *   `(userId, periodKey, idempotencyKey)` and check it before incrementing.
 */
export const authorizeInvocationAndReserveRequest = internalMutation({
  args: {
    userId: v.id("users"),
    agentId: v.id("agents"),
    deploymentId: v.id("deployments"),

    // v1 period standard (UTC calendar month): "YYYY-MM"
    periodKey: v.string(),

    runtimeProvider: v.union(v.literal("cloudflare"), v.literal("agentcore")),

    // Optional (useful for logs/audit; not used for idempotency yet):
    traceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertNonEmptyString(args.periodKey, "periodKey");

    const runtimeProvider = args.runtimeProvider as RuntimeProvider;

    // Load user (server authoritative tier source).
    const user = (await ctx.db.get(args.userId)) as Doc<"users"> | null;
    if (!user) throw new Error("Not found");

    const tier = normalizeTier(user.tier);
    const entitlements = getEntitlementsForTier(tier);

    // Runtime gating (defense in depth).
    if (!isRuntimeProviderAllowed(entitlements, runtimeProvider)) {
      return {
        ok: false as const,
        denied: {
          kind: "runtime_gated" as const,
          message: "Runtime provider not entitled",
          tier,
          runtimeProvider,
          periodKey: args.periodKey,
        },
      };
    }

    // Ownership + invokable checks.
    const agent = (await ctx.db.get(args.agentId)) as Doc<"agents"> | null;
    if (!agent) throw new Error("Not found");
    if (agent.userId !== args.userId) throw new Error("Not found"); // IDOR-safe

    // Treat deleted as not found (soft delete semantics).
    if (agent.status === "deleted") throw new Error("Not found");
    if (agent.status === "disabled") throw new Error("Agent is disabled");

    const deployment = (await ctx.db.get(
      args.deploymentId,
    )) as Doc<"deployments"> | null;
    if (!deployment) throw new Error("Not found");
    if (deployment.userId !== args.userId) throw new Error("Not found");
    if (deployment.agentId !== args.agentId) throw new Error("Not found");

    // Strict: only allow invocations against an "active" deployment record.
    // (Routing is expected to use agents.activeDeploymentId; this is defense in depth.)
    if (deployment.status !== "active") {
      throw new Error("Deployment is not invokable");
    }

    if (deployment.runtimeProvider !== runtimeProvider) {
      throw new Error("runtimeProvider mismatch");
    }

    const maxRequestsPerPeriod = toNonNegativeInt(
      entitlements.limits.maxRequestsPerPeriod,
    );

    const now = Date.now();

    // Load or create requestUsageCounters row for this user+period.
    const existing = await ctx.db
      .query("requestUsageCounters")
      .withIndex("by_userId_periodKey", (q) =>
        q.eq("userId", args.userId).eq("periodKey", args.periodKey),
      )
      .unique();

    const counterId: Id<"requestUsageCounters"> = existing
      ? existing._id
      : await ctx.db.insert("requestUsageCounters", {
          userId: args.userId,
          periodKey: args.periodKey,
          requestsUsed: 0,
          updatedAtMs: now,
        });

    const current = existing ?? ((await ctx.db.get(counterId)) as any);
    const currentRequestsUsed = toNonNegativeInt(current?.requestsUsed);

    if (currentRequestsUsed >= maxRequestsPerPeriod) {
      return {
        ok: false as const,
        denied: {
          kind: "requests_limit_exceeded" as const,
          message: "Request limit exceeded",
          tier,
          runtimeProvider,
          periodKey: args.periodKey,
          maxRequestsPerPeriod,
          requestsUsed: currentRequestsUsed,
        },
      };
    }

    // Reserve exactly one request.
    await ctx.db.patch(counterId, {
      requestsUsed: currentRequestsUsed + 1,
      updatedAtMs: now,
    });

    const updated = await ctx.db.get(counterId);
    const updatedRequestsUsed = toNonNegativeInt(
      (updated as any)?.requestsUsed,
    );

    return {
      ok: true as const,
      periodKey: args.periodKey,
      reserved: 1,
      requestsBefore: currentRequestsUsed,
      requestsAfter: updatedRequestsUsed,
      maxRequestsPerPeriod,
      runtimeProvider,
      tier,
      traceId: normalizeOptionalId(args.traceId) ?? undefined,

      // Structured preflight result (caller may log or map to error envelopes).
      preflight: {
        kind: "reserved" as const,
        tier,
        runtimeProvider,
        periodKey: args.periodKey,
        maxRequestsPerPeriod,
        requestsBefore: currentRequestsUsed,
        requestsAfter: updatedRequestsUsed,
      },
    };
  },
});

type InvocationPreflightDenied =
  | {
      kind: "runtime_gated";
      message: string;
      tier: Tier;
      runtimeProvider: RuntimeProvider;
      periodKey: string;
    }
  | {
      kind: "requests_limit_exceeded";
      message: string;
      tier: Tier;
      runtimeProvider: RuntimeProvider;
      periodKey: string;
      maxRequestsPerPeriod: number;
      requestsUsed: number;
    };

function normalizeTier(tier: unknown): Tier {
  if (tier === "free" || tier === "pro" || tier === "enterprise") return tier;
  return "free";
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${field}`);
  }
  // Bound to keep storage/query predictable and avoid abuse.
  if (value.length > 32) {
    throw new Error(`Invalid ${field}`);
  }
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const n = Math.trunc(value);
  return n < 0 ? 0 : n;
}

function normalizeOptionalId(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 200) return trimmed.slice(0, 200);
  return trimmed;
}
