import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * Internal telemetry ingestion mutation (append-only) with dedupe.
 *
 * Intended caller:
 * - A server-only HTTP action that has already:
 *   - verified the deployment-scoped HMAC signature over the raw body bytes (ADR-0004)
 *   - parsed and validated the telemetry payload schema (50_OBSERVABILITY_BILLING_LIMITS.md)
 *
 * Defense in depth (implemented here too):
 * - Verify the `{userId, agentId, deploymentId}` relationship against the deployment record
 * - Verify `runtimeProvider` matches the deployment's runtime provider
 *
 * Idempotency / dedupe (recommended in v1):
 * - Prefer `eventId` when provided (dedupe by `(deploymentId, eventId)`).
 * - Fallback to `traceId` when `eventId` is absent (dedupe by `(deploymentId, traceId)`).
 *
 * Notes:
 * - This mutation MUST NOT accept or store any secret values.
 * - This mutation is append-only: it never updates existing `metricsEvents` rows.
 */
export const ingestMetricsEvent = internalMutation({
  args: {
    userId: v.id("users"),
    agentId: v.id("agents"),
    deploymentId: v.id("deployments"),

    runtimeProvider: v.union(v.literal("cloudflare"), v.literal("agentcore")),

    // Idempotency keys (recommended):
    eventId: v.optional(v.string()),
    traceId: v.optional(v.string()),

    timestampMs: v.number(),

    requests: v.number(),
    llmTokens: v.number(),
    computeMs: v.number(),
    toolCalls: v.optional(v.number()),

    errors: v.number(),
    errorClass: v.optional(
      v.union(
        v.literal("auth"),
        v.literal("limit"),
        v.literal("runtime"),
        v.literal("tool"),
        v.literal("unknown"),
      ),
    ),

    costUsdEstimated: v.number(),

    provider: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Basic numeric validation (keep strict and deterministic; caller should validate too).
    assertFiniteNumber(args.timestampMs, "timestampMs");
    assertFiniteNumber(args.requests, "requests");
    assertFiniteNumber(args.llmTokens, "llmTokens");
    assertFiniteNumber(args.computeMs, "computeMs");
    assertFiniteNumber(args.errors, "errors");
    assertFiniteNumber(args.costUsdEstimated, "costUsdEstimated");
    if (args.toolCalls !== undefined)
      assertFiniteNumber(args.toolCalls, "toolCalls");

    assertNonNegativeIntegerLike(args.requests, "requests");
    assertNonNegativeIntegerLike(args.llmTokens, "llmTokens");
    assertNonNegativeIntegerLike(args.computeMs, "computeMs");
    assertNonNegativeIntegerLike(args.errors, "errors");
    if (args.toolCalls !== undefined)
      assertNonNegativeIntegerLike(args.toolCalls, "toolCalls");

    if (args.costUsdEstimated < 0) {
      throw new Error("Invalid costUsdEstimated");
    }

    // Defense in depth: validate deployment ownership + relationship.
    const deployment = await ctx.db.get(args.deploymentId);
    if (!deployment) {
      // IDOR-safe in internal code as well.
      throw new Error("Not found");
    }
    if (deployment.userId !== args.userId) throw new Error("Not found");
    if (deployment.agentId !== args.agentId) throw new Error("Not found");
    if (deployment.runtimeProvider !== args.runtimeProvider) {
      throw new Error("Telemetry runtimeProvider mismatch");
    }

    // Dedupe strategy:
    // 1) eventId (preferred)
    // 2) traceId (fallback)
    const eventId = normalizeOptionalId(args.eventId);
    if (eventId) {
      const existing = await ctx.db
        .query("metricsEvents")
        .withIndex("by_deploymentId_eventId", (q) =>
          q.eq("deploymentId", args.deploymentId).eq("eventId", eventId),
        )
        .unique();

      if (existing) {
        return {
          deduped: true,
          metricsEventId: existing._id,
          dedupeKey: "eventId" as const,
        };
      }
    } else {
      const traceId = normalizeOptionalId(args.traceId);
      if (traceId) {
        const existing = await ctx.db
          .query("metricsEvents")
          .withIndex("by_deploymentId_traceId", (q) =>
            q.eq("deploymentId", args.deploymentId).eq("traceId", traceId),
          )
          .unique();

        if (existing) {
          return {
            deduped: true,
            metricsEventId: existing._id,
            dedupeKey: "traceId" as const,
          };
        }
      }
    }

    // Append-only insert.
    const metricsEventId = await ctx.db.insert("metricsEvents", {
      userId: args.userId,
      agentId: args.agentId,
      deploymentId: args.deploymentId,
      runtimeProvider: args.runtimeProvider,

      eventId: eventId ?? undefined,
      traceId: normalizeOptionalId(args.traceId) ?? undefined,

      timestampMs: Math.trunc(args.timestampMs),

      requests: Math.trunc(args.requests),
      llmTokens: Math.trunc(args.llmTokens),
      computeMs: Math.trunc(args.computeMs),
      toolCalls:
        args.toolCalls !== undefined ? Math.trunc(args.toolCalls) : undefined,

      errors: Math.trunc(args.errors),
      errorClass: args.errorClass,

      costUsdEstimated: args.costUsdEstimated,

      // Provider-specific metadata/counters (must be sanitized by caller; no secrets).
      provider: args.provider,
    });

    // Increment aggregated usage for the billing period.
    //
    // Notes:
    // - This is an incremental optimization for the dashboard; `billingUsage` remains derived data
    //   and should be recomputable from `metricsEvents` (spec requirement).
    // - We bucket by the telemetry event timestamp (not "now") so aggregation is deterministic.
    const periodKey = getPeriodKeyUtcFromTimestampMs(args.timestampMs);
    const now = Date.now();
    const toolCallsInc = args.toolCalls ?? 0;

    const existingUsage = await ctx.db
      .query("billingUsage")
      .withIndex("by_userId_periodKey", (q) =>
        q.eq("userId", args.userId).eq("periodKey", periodKey),
      )
      .unique();

    let billingUsageId: any;

    if (!existingUsage) {
      billingUsageId = await ctx.db.insert("billingUsage", {
        userId: args.userId,
        periodKey,
        requests: args.requests,
        llmTokens: args.llmTokens,
        computeMs: args.computeMs,
        toolCalls: toolCallsInc,
        costUsdEstimated: args.costUsdEstimated,
        updatedAtMs: now,
      });
    } else {
      billingUsageId = existingUsage._id;

      await ctx.db.patch(existingUsage._id, {
        requests: numberOrZero(existingUsage.requests) + args.requests,
        llmTokens: numberOrZero(existingUsage.llmTokens) + args.llmTokens,
        computeMs: numberOrZero(existingUsage.computeMs) + args.computeMs,
        toolCalls: numberOrZero(existingUsage.toolCalls) + toolCallsInc,
        costUsdEstimated:
          numberOrZero(existingUsage.costUsdEstimated) + args.costUsdEstimated,
        updatedAtMs: now,
      });
    }

    return {
      deduped: false,
      metricsEventId,
      billingUsageId,
      periodKey,
      dedupeKey: (eventId ? "eventId" : args.traceId ? "traceId" : "none") as
        | "eventId"
        | "traceId"
        | "none",
    };
  },
});

/**
 * v1 period key: calendar month, UTC, formatted as `YYYY-MM`.
 *
 * IMPORTANT: We derive this from the telemetry event timestamp so aggregation is deterministic.
 */
function getPeriodKeyUtcFromTimestampMs(timestampMs: number): string {
  const d = new Date(timestampMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1..12
  return `${year}-${String(month).padStart(2, "0")}`;
}

function numberOrZero(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}

function normalizeOptionalId(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Bound length to reduce abuse / accidental huge headers.
  if (trimmed.length > 200) return trimmed.slice(0, 200);
  return trimmed;
}

function assertFiniteNumber(n: number, field: string): void {
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid ${field}`);
  }
}

function assertNonNegativeIntegerLike(n: number, field: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid ${field}`);
  }
}
