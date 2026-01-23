import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

/**
 * Internal queries intended ONLY for server-side Actions (deploy orchestration, telemetry ingestion, etc).
 *
 * Why this file exists:
 * - Actions often need small, reusable DB lookups without duplicating logic.
 * - These helpers centralize common "load by id" and "load + ownership guard" patterns.
 *
 * Security note:
 * - These are INTERNAL queries, not client-facing APIs.
 * - Prefer using the `*OwnedByUser` variants to reduce the chance of IDOR mistakes in actions.
 */

/**
 * Load an agent by id with no ownership checks.
 * Use only when the caller already performed tenant isolation checks.
 */
export const getAgentById = internalQuery({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.agentId);
  },
});

/**
 * Load a deployment by id with no ownership checks.
 * Use only when the caller already performed tenant isolation checks.
 */
export const getDeploymentById = internalQuery({
  args: {
    deploymentId: v.id("deployments"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.deploymentId);
  },
});

/**
 * Load an agent by id, but return null if it is not owned by `userId`.
 *
 * IDOR-safe behavior:
 * - If the agent doesn't exist OR is not owned by the user, return null.
 */
export const getAgentOwnedByUser = internalQuery({
  args: {
    userId: v.id("users"),
    agentId: v.id("agents"),
    includeDeleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    if (agent.userId !== args.userId) return null;

    const includeDeleted = args.includeDeleted ?? false;
    if (!includeDeleted && agent.status === "deleted") return null;

    return agent;
  },
});

/**
 * Load a deployment by id, but return null if it is not owned by `userId`.
 *
 * Optional additional guard:
 * - If `agentId` is provided, also ensure the deployment belongs to that agent.
 *
 * IDOR-safe behavior:
 * - If the deployment doesn't exist OR is not owned by the user, return null.
 */
export const getDeploymentOwnedByUser = internalQuery({
  args: {
    userId: v.id("users"),
    deploymentId: v.id("deployments"),
    agentId: v.optional(v.id("agents")),
  },
  handler: async (ctx, args) => {
    const deployment = await ctx.db.get(args.deploymentId);
    if (!deployment) return null;
    if (deployment.userId !== args.userId) return null;

    if (args.agentId !== undefined && deployment.agentId !== args.agentId) {
      return null;
    }

    return deployment;
  },
});

/**
 * Load an agent (owned) plus its active deployment (owned) in one call pattern.
 *
 * Returns:
 * - null if the agent doesn't exist, isn't owned, is deleted (unless includeDeleted), or has no active deployment.
 * - `{ agent, deployment }` when both resolve and are consistent.
 *
 * This is useful for invoke routing paths that MUST route only via `agents.activeDeploymentId`
 * (ADR-0005).
 */
export const getAgentWithActiveDeploymentOwnedByUser = internalQuery({
  args: {
    userId: v.id("users"),
    agentId: v.id("agents"),
    includeDeleted: v.optional(v.boolean()),
    /**
     * If true (default), require the deployment status to be "active".
     * Some admin/debug flows may set this to false to inspect non-active pointers.
     */
    requireDeploymentActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) return null;
    if (agent.userId !== args.userId) return null;

    const includeDeleted = args.includeDeleted ?? false;
    if (!includeDeleted && agent.status === "deleted") return null;

    const activeDeploymentId = agent.activeDeploymentId;
    if (!activeDeploymentId) return null;

    const deployment = await ctx.db.get(activeDeploymentId);
    if (!deployment) return null;

    // Defense in depth: ensure relationship consistency.
    if (deployment.userId !== args.userId) return null;
    if (deployment.agentId !== agent._id) return null;

    const requireDeploymentActive = args.requireDeploymentActive ?? true;
    if (requireDeploymentActive && deployment.status !== "active") return null;

    return { agent, deployment };
  },
});
