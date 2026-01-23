import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Internal deploy finalization mutations (server-only).
 *
 * Purpose (Slice B):
 * - Finalize deployment status (`deploying` -> `active` | `failed`)
 * - Update `agents.activeDeploymentId` routing pointer on success (ADR-0005)
 *
 * Normative constraints:
 * - Deployment records are immutable except for:
 *   - `status`
 *   - `providerRef`
 *   - `telemetryAuthRef`
 *   - `errorMessage`
 *   - `deployedAtMs`, `finishedAtMs`
 *   - `logsRef`
 *
 * Security:
 * - These are INTERNAL mutations and must only be called from trusted server Actions.
 * - We still enforce ownership + relationship checks as defense in depth.
 *
 * Idempotency:
 * - Finalization actions may be retried. These mutations are designed to be safe to call
 *   multiple times with the same arguments.
 */

const deploymentStatus = v.union(
  v.literal("deploying"),
  v.literal("active"),
  v.literal("failed"),
  v.literal("inactive"),
);

export const finalizeDeploymentSuccess = internalMutation({
  args: {
    userId: v.id("users"),
    agentId: v.id("agents"),
    deploymentId: v.id("deployments"),

    // Provider outputs (opaque at this layer; must be JSON-serializable)
    providerRef: v.any(),
    telemetryAuthRef: v.any(),

    deployedAtMs: v.optional(v.number()),
    logsRef: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const agent = await getAgentOwnedOrThrow(ctx, args.userId, args.agentId);
    const deployment = await getDeploymentOwnedOrThrow(
      ctx,
      args.userId,
      args.agentId,
      args.deploymentId,
    );

    // Soft-delete/disabled safety: do not re-activate deleted/disabled agents.
    if (agent.status === "deleted") throw new Error("Not found");
    if (agent.status === "disabled") throw new Error("Agent is disabled");

    // Idempotency: if already active and pointer already set, treat as success.
    if (deployment.status === "active") {
      // Ensure routing pointer is correct (best effort).
      if (agent.activeDeploymentId !== deployment._id) {
        await ctx.db.patch(agent._id, {
          activeDeploymentId: deployment._id,
          status: "active",
          updatedAtMs: now,
        });
      }
      return { agentId: agent._id, deploymentId: deployment._id, status: "active" as const };
    }

    // Only allow transitioning from deploying -> active.
    // If it was failed/inactive already, this is either a logic error or a stale retry.
    if (deployment.status !== "deploying") {
      throw new Error("Deployment is not in a finalizable state");
    }

    // Guardrails: only set providerRef/telemetryAuthRef if not already set, or if identical.
    // This protects immutability expectations while still allowing idempotent retries.
    assertCanSetOpaqueField("providerRef", deployment.providerRef, args.providerRef);
    assertCanSetOpaqueField(
      "telemetryAuthRef",
      deployment.telemetryAuthRef,
      args.telemetryAuthRef,
    );

    const deployedAtMs = args.deployedAtMs ?? now;

    // Update previously active deployment to inactive (optional best-effort).
    // This is NOT required for routing (routing uses the pointer), but keeps history clearer.
    const previousActiveId = agent.activeDeploymentId;
    if (previousActiveId && previousActiveId !== deployment._id) {
      const prev = await ctx.db.get(previousActiveId);
      if (prev && prev.userId === args.userId && prev.agentId === args.agentId) {
        if (prev.status === "active") {
          await ctx.db.patch(prev._id, {
            status: "inactive",
            finishedAtMs: prev.finishedAtMs ?? now,
          });
        }
      }
    }

    await ctx.db.patch(deployment._id, {
      status: "active",
      providerRef: args.providerRef,
      telemetryAuthRef: args.telemetryAuthRef,
      errorMessage: undefined,
      deployedAtMs,
      finishedAtMs: now,
      logsRef: args.logsRef,
    });

    await ctx.db.patch(agent._id, {
      activeDeploymentId: deployment._id,
      status: "active",
      updatedAtMs: now,
    });

    // Audit log (sanitized; no secrets)
    await ctx.db.insert("auditLog", {
      userId: args.userId,
      atMs: now,
      action: "deployment.finalize.success",
      meta: {
        agentId: args.agentId,
        deploymentId: args.deploymentId,
        version: deployment.version,
        runtimeProvider: deployment.runtimeProvider,
      },
    });

    return { agentId: agent._id, deploymentId: deployment._id, status: "active" as const };
  },
});

export const finalizeDeploymentFailure = internalMutation({
  args: {
    userId: v.id("users"),
    agentId: v.id("agents"),
    deploymentId: v.id("deployments"),

    errorMessage: v.string(),
    logsRef: v.optional(v.any()),
    finishedAtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const agent = await getAgentOwnedOrThrow(ctx, args.userId, args.agentId);
    const deployment = await getDeploymentOwnedOrThrow(
      ctx,
      args.userId,
      args.agentId,
      args.deploymentId,
    );

    // If agent was deleted/disabled during deploy, still record failure on deployment,
    // but do not change routing pointer.
    const agentIsUsable = agent.status !== "deleted" && agent.status !== "disabled";

    // Idempotency: if already failed, do not overwrite provider refs; just ensure errorMessage exists.
    if (deployment.status === "failed") {
      return { agentId: agent._id, deploymentId: deployment._id, status: "failed" as const };
    }

    // Only allow transitioning from deploying -> failed.
    if (deployment.status !== "deploying") {
      throw new Error("Deployment is not in a finalizable state");
    }

    const finishedAtMs = args.finishedAtMs ?? now;
    const errorMessage = sanitizeErrorMessage(args.errorMessage);

    await ctx.db.patch(deployment._id, {
      status: "failed",
      errorMessage,
      finishedAtMs,
      logsRef: args.logsRef,
    });

    if (agentIsUsable) {
      // Do not clear `activeDeploymentId`; a previous active deployment may still exist and be usable.
      await ctx.db.patch(agent._id, {
        status: "error",
        updatedAtMs: now,
      });
    }

    await ctx.db.insert("auditLog", {
      userId: args.userId,
      atMs: now,
      action: "deployment.finalize.failure",
      meta: {
        agentId: args.agentId,
        deploymentId: args.deploymentId,
        version: deployment.version,
        runtimeProvider: deployment.runtimeProvider,
      },
    });

    return { agentId: agent._id, deploymentId: deployment._id, status: "failed" as const };
  },
});

async function getAgentOwnedOrThrow(
  ctx: { db: any },
  userId: Id<"users">,
  agentId: Id<"agents">,
): Promise<Doc<"agents">> {
  const agent = (await ctx.db.get(agentId)) as Doc<"agents"> | null;
  if (!agent) throw new Error("Not found");
  if (agent.userId !== userId) throw new Error("Not found");
  return agent;
}

async function getDeploymentOwnedOrThrow(
  ctx: { db: any },
  userId: Id<"users">,
  agentId: Id<"agents">,
  deploymentId: Id<"deployments">,
): Promise<Doc<"deployments">> {
  const deployment = (await ctx.db.get(deploymentId)) as Doc<"deployments"> | null;
  if (!deployment) throw new Error("Not found");
  if (deployment.userId !== userId) throw new Error("Not found");
  if (deployment.agentId !== agentId) throw new Error("Not found");
  return deployment;
}

/**
 * Prevent accidental mutation of "set-once" opaque fields (providerRef, telemetryAuthRef)
 * while still allowing idempotent retries.
 */
function assertCanSetOpaqueField(fieldName: string, existing: unknown, next: unknown): void {
  if (existing === undefined || existing === null) return;

  // If already set, only allow re-setting if identical (best-effort).
  if (!safeDeepEqual(existing, next)) {
    throw new Error(`${fieldName} is already set and cannot be changed`);
  }
}

function safeDeepEqual(a: unknown, b: unknown): boolean {
  // Fast path
  if (a === b) return true;

  // Best-effort structural equality via JSON (works for plain objects).
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    // If not serializable, fall back to strict equality (already checked).
    return false;
  }
}

function sanitizeErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "Deployment failed";
  // Keep messages UI-safe and bounded. Do not include secrets here.
  const MAX = 500;
  return trimmed.length > MAX ? trimmed.slice(0, MAX) : trimmed;
}
