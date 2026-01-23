import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireCurrentUser } from "../lib/auth";

/**
 * Deployment read queries (v1) with strict tenant isolation.
 *
 * Normative sources:
 * - project_spec/spec_v1/10_API_CONTRACTS.md (Deployments API)
 * - project_spec/spec_v1/30_DATA_MODEL_CONVEX.md (ownership rules)
 * - project_spec/spec_v1/adr/ADR-0005-deployment-immutability.md (immutable deployments + routing pointer)
 *
 * Security invariants:
 * - Client-supplied user identifiers are never used for authorization.
 * - All reads are scoped to the authenticated user's internal `users._id`.
 * - If a resource exists but is not owned by the caller, we behave as if it does not exist
 *   (IDOR-safe behavior).
 */

const deploymentStatus = v.union(
  v.literal("deploying"),
  v.literal("active"),
  v.literal("failed"),
  v.literal("inactive"),
);

export const listDeploymentsByAgent = query({
  args: {
    agentId: v.id("agents"),
    /**
     * Basic pagination (v1 minimal). For full cursor pagination, add it later.
     */
    limit: v.optional(v.number()),
    /**
     * Optional status filter.
     */
    status: v.optional(deploymentStatus),
    /**
     * By default, return deployments across all statuses (including failed/inactive),
     * which supports rollback UX (ADR-0005).
     *
     * If false, we hide `inactive` deployments (often helpful for a "current" view).
     */
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireCurrentUser(ctx);

    // First, load the agent and enforce ownership. This avoids scanning deployments for
    // agent ids the caller doesn't own (defense in depth).
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return [];
    if (agent.userId !== userId) return [];
    if (agent.status === "deleted") return [];

    const limit = normalizeLimit(args.limit);
    const includeInactive = args.includeInactive ?? true;

    // We rely on the `by_agentId_version` index for deterministic ordering.
    let q = ctx.db
      .query("deployments")
      .withIndex("by_agentId_version", (q) => q.eq("agentId", args.agentId));

    if (args.status) {
      q = q.filter((q) => q.eq(q.field("status"), args.status));
    } else if (!includeInactive) {
      q = q.filter((q) => q.neq(q.field("status"), "inactive"));
    }

    // Because we already validated agent ownership above, deployments for this agentId
    // should all match `userId`. Still, filter as defense in depth.
    q = q.filter((q) => q.eq(q.field("userId"), userId));

    return await q.order("desc").take(limit);
  },
});

export const getDeployment = query({
  args: {
    agentId: v.id("agents"),
    deploymentId: v.id("deployments"),
    /**
     * By default, treat inactive deployments as readable (needed for rollback UX).
     * If you want "current only" views, set this false in the caller and we will
     * treat inactive deployments as not found.
     */
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireCurrentUser(ctx);

    // Agent ownership gate first (IDOR-safe behavior).
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    if (agent.userId !== userId) return null;
    if (agent.status === "deleted") return null;

    const deployment = await ctx.db.get(args.deploymentId);
    if (!deployment) return null;

    // Relationship + tenant checks (defense in depth).
    if (deployment.userId !== userId) return null;
    if (deployment.agentId !== agent._id) return null;

    const includeInactive = args.includeInactive ?? true;
    if (!includeInactive && deployment.status === "inactive") return null;

    return deployment;
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
