import { v } from "convex/values";
import { query } from "../_generated/server";
import { getCurrentUser, requireCurrentUser } from "../lib/auth";

/**
 * Agent read queries (v1) with strict tenant isolation.
 *
 * Normative sources:
 * - project_spec/spec_v1/10_API_CONTRACTS.md (Agents API)
 * - project_spec/spec_v1/30_DATA_MODEL_CONVEX.md (ownership rules)
 *
 * Security invariants:
 * - All reads are scoped to the authenticated user's internal `users._id`.
 * - If an agent exists but is not owned by the caller, we behave as if it does not exist.
 */

const agentStatus = v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("deploying"),
  v.literal("active"),
  v.literal("error"),
  v.literal("disabled"),
  v.literal("deleted")
);

export const listAgents = query({
  args: {
    /**
     * Basic pagination (v1 minimal). For full cursor-based pagination, layer it in later.
     */
    limit: v.optional(v.number()),

    /**
     * Optional status filter (e.g. list only "active" agents).
     */
    status: v.optional(agentStatus),

    /**
     * By default, soft-deleted agents are excluded.
     */
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const current = await requireCurrentUser(ctx);

    const limit = normalizeLimit(args.limit);
    const includeDeleted = args.includeDeleted ?? false;

    let q = ctx.db.query("agents").withIndex("by_userId", (q) => q.eq("userId", current.userId));

    if (args.status) {
      q = q.filter((q) => q.eq(q.field("status"), args.status));
    } else if (!includeDeleted) {
      q = q.filter((q) => q.neq(q.field("status"), "deleted"));
    }

    // Deterministic ordering by creation time (newest first).
    return await q.order("desc").take(limit);
  },
});

export const getAgent = query({
  args: {
    agentId: v.id("agents"),
    /**
     * By default, soft-deleted agents are treated as not found.
     * This is useful for admin/ops views if you later add them.
     */
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const current = await getCurrentUser(ctx);
    if (!current) {
      // Auth is required for agent resources in v1.
      // Upstream HTTP layer should translate this to the normalized error envelope.
      throw new Error("Not authenticated");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;

    if (agent.userId !== current.userId) {
      // IDOR safety: do not reveal existence.
      return null;
    }

    const includeDeleted = args.includeDeleted ?? false;
    if (!includeDeleted && agent.status === "deleted") return null;

    return agent;
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
