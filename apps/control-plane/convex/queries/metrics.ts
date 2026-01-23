import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireCurrentUser } from "../lib/auth";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Metrics / telemetry read queries (v1)
 *
 * Purpose:
 * - List recent raw telemetry events for an agent with strict tenant isolation.
 *
 * Normative references:
 * - project_spec/spec_v1/30_DATA_MODEL_CONVEX.md (tenant isolation rules)
 * - project_spec/spec_v1/50_OBSERVABILITY_BILLING_LIMITS.md (telemetry event schema)
 *
 * Security invariants:
 * - All reads are scoped to the authenticated user's internal `users._id`.
 * - Client-supplied userId is never accepted.
 * - If an agent exists but is not owned by the caller, results must be empty / not found
 *   (IDOR-safe behavior).
 */
export const listRecentMetricsEventsByAgent = query({
  args: {
    agentId: v.id("agents"),

    /**
     * Lower bound for event timestamps (unix ms).
     * If omitted, defaults to the last 1 hour.
     */
    sinceMs: v.optional(v.number()),

    /**
     * Max number of events to return. Defaults to 50, max 200.
     */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireCurrentUser(ctx);

    const limit = normalizeLimit(args.limit);
    const sinceMs = normalizeSinceMs(args.sinceMs);

    // Defense in depth: ensure the agent belongs to the current user.
    // This prevents leaking whether an agent exists for another tenant.
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return [];
    if (agent.userId !== userId) return [];

    // Efficient query using the compound index.
    const events = await ctx.db
      .query("metricsEvents")
      .withIndex("by_userId_agentId_timestampMs", (q) =>
        q.eq("userId", userId).eq("agentId", args.agentId),
      )
      .filter((q) => q.gte(q.field("timestampMs"), sinceMs))
      .order("desc")
      .take(limit);

    return events;
  },
});

/**
 * Optional helper query: list recent events for a specific deployment (still tenant-isolated).
 * This is useful for debugging a single deployment version while keeping queries fast.
 */
export const listRecentMetricsEventsByDeployment = query({
  args: {
    deploymentId: v.id("deployments"),
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireCurrentUser(ctx);

    const limit = normalizeLimit(args.limit);
    const sinceMs = normalizeSinceMs(args.sinceMs);

    const deployment = await ctx.db.get(args.deploymentId);
    if (!deployment) return [];
    if (deployment.userId !== userId) return [];

    const events = await ctx.db
      .query("metricsEvents")
      .withIndex("by_deploymentId_timestampMs", (q) =>
        q.eq("deploymentId", args.deploymentId),
      )
      .filter((q) => q.gte(q.field("timestampMs"), sinceMs))
      .order("desc")
      .take(limit);

    return events;
  },
});

function normalizeLimit(limit: number | undefined): number {
  const DEFAULT = 50;
  const MAX = 200;

  if (limit === undefined) return DEFAULT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    throw new Error("Invalid limit");
  }
  return Math.min(limit, MAX);
}

function normalizeSinceMs(sinceMs: number | undefined): number {
  const now = Date.now();

  // Default to last hour.
  if (sinceMs === undefined) return now - 60 * 60 * 1000;

  if (!Number.isFinite(sinceMs)) {
    throw new Error("Invalid sinceMs");
  }

  // Clamp far-future values to now to avoid confusing empty results.
  if (sinceMs > now) return now;

  // Clamp extremely old values to reduce accidental heavy scans in v1.
  // (Indexes help, but this keeps UX reasonable and avoids unexpected large result windows.)
  const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const minAllowed = now - MAX_WINDOW_MS;

  return sinceMs < minAllowed ? minAllowed : Math.trunc(sinceMs);
}
