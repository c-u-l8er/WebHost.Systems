import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { getOrCreateCurrentUser } from "../lib/auth";
import {
  getEntitlementsForTier,
  isRuntimeProviderAllowed,
} from "../lib/entitlements";
import { renderCloudflareWorkerTemplate } from "../providers/cloudflareWorkerTemplate";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Deployment orchestration mutations (v1).
 *
 * Normative requirements implemented here:
 * - Deployment immutability + active pointer routing (ADR-0005)
 *   - Each deploy attempt creates a NEW `deployments` row.
 *   - `agents.activeDeploymentId` is the only routing pointer.
 * - Single-writer deploy rule per agent (ADR-0005 v1 simplification)
 *   - Reject concurrent deploy attempts while `agent.status === "deploying"`.
 *
 * Provider-specific orchestration (Cloudflare API calls, secret injection, etc.) MUST happen
 * in server-only Actions. This file schedules those actions and enforces invariants.
 */

const runtimeProvider = v.union(
  v.literal("cloudflare"),
  v.literal("agentcore"),
);

export const createAndDeploy = mutation({
  args: {
    agentId: v.id("agents"),

    /**
     * v1: runtimeProvider is optional; default to agent preference or "cloudflare".
     * Runtime gating for AgentCore is enforced here (tier-based baseline) and should also be
     * enforced inside the provider adapter (defense in depth).
     */
    runtimeProvider: v.optional(runtimeProvider),

    /**
     * Slice B: accept inline Worker module code for Cloudflare deployment.
     * If omitted, we deploy a built-in deterministic worker template.
     *
     * In the full v1, this will typically come from an artifact pipeline instead.
     */
    moduleCode: v.optional(v.string()),

    /**
     * Optional tuning for Cloudflare Worker upload.
     */
    compatibilityDate: v.optional(v.string()),
    invokePath: v.optional(v.string()),
    mainModuleName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, user, identity } = await getOrCreateCurrentUser(ctx);

    const agent = await getAgentOwnedOrThrow(ctx, userId, args.agentId);

    // Treat deleted as not found (soft-delete).
    if (agent.status === "deleted") throw new Error("Not found");
    if (agent.status === "disabled") throw new Error("Agent is disabled");

    // ADR-0005 single-writer rule (v1).
    if (agent.status === "deploying") {
      throw new Error("Deploy already in progress");
    }

    const chosenRuntimeProvider =
      args.runtimeProvider ?? agent.preferredRuntimeProvider ?? "cloudflare";

    // Runtime gating (ADR-0007): enforce via centralized entitlements mapping (server-authoritative).
    // Defense in depth: adapters must ALSO enforce this in deploy/invoke paths.
    const entitlements = getEntitlementsForTier(user.tier);
    if (!isRuntimeProviderAllowed(entitlements, chosenRuntimeProvider)) {
      throw new Error("Runtime provider is not enabled for your tier");
    }

    // v1 Slice B: only Cloudflare is wired. Keep this explicit to avoid silent partial behavior.
    if (chosenRuntimeProvider !== "cloudflare") {
      throw new Error("Requested runtimeProvider is not enabled in this build");
    }

    const moduleCode =
      args.moduleCode ??
      renderCloudflareWorkerTemplate({
        invokePath: args.invokePath ?? "/invoke",
      });

    const now = Date.now();

    // Compute next deployment version (monotonic per agent).
    const nextVersion = await getNextDeploymentVersion(ctx, agent._id);

    // Create immutable deployment record first (required for safe orchestration).
    const deploymentId = await ctx.db.insert("deployments", {
      userId,
      agentId: agent._id,

      version: nextVersion,

      protocol: "invoke/v1",
      runtimeProvider: chosenRuntimeProvider,
      status: "deploying",

      // Minimal artifact metadata for Slice B. (No plaintext secrets here.)
      artifact: {
        type: "inlineModule",
      },

      providerRef: undefined,
      telemetryAuthRef: undefined,
      errorMessage: undefined,
      logsRef: undefined,

      createdAtMs: now,
      deployedAtMs: undefined,
      finishedAtMs: undefined,
    });

    // Mark agent as deploying to enforce single-writer rule and surface state in UI.
    await ctx.db.patch(agent._id, {
      status: "deploying",
      updatedAtMs: now,
    });

    // Audit log (server-written, sanitized).
    await ctx.db.insert("auditLog", {
      userId,
      atMs: now,
      action: "deployment.create",
      actor: {
        identitySubject: identity.subject ?? undefined,
      },
      meta: {
        agentId: agent._id,
        deploymentId,
        runtimeProvider: chosenRuntimeProvider,
        version: nextVersion,
      },
    });

    // Server-only deploy orchestration via action (external provider calls must not happen in mutation).
    //
    // NOTE: This action must:
    // - deploy the worker,
    // - inject deployment-scoped telemetry signing secret,
    // - patch deployment mutable fields (status/providerRef/telemetryAuthRef/timestamps/errorMessage),
    // - set `agents.activeDeploymentId` on success,
    // - set `agents.status` to "active" on success, or "error" on failure.
    await ctx.scheduler.runAfter(
      0,
      (internal as any)["actions/deployCloudflareDeployment"]
        .deployCloudflareDeployment,
      {
        agentId: agent._id,
        deploymentId,
        moduleCode,
        compatibilityDate: args.compatibilityDate,
        invokePath: args.invokePath,
        mainModuleName: args.mainModuleName,
      },
    );

    const deployment = await ctx.db.get(deploymentId);
    if (!deployment) throw new Error("Failed to create deployment");
    return deployment;
  },
});

export const activateDeployment = mutation({
  args: {
    agentId: v.id("agents"),
    deploymentId: v.id("deployments"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, identity } = await getOrCreateCurrentUser(ctx);

    const agent = await getAgentOwnedOrThrow(ctx, userId, args.agentId);

    if (agent.status === "deleted") throw new Error("Not found");
    if (agent.status === "disabled") throw new Error("Agent is disabled");

    // v1 simplification: do not allow activation while a deploy is in progress.
    if (agent.status === "deploying") {
      throw new Error("Cannot activate deployment while deploy is in progress");
    }

    const deployment = await ctx.db.get(args.deploymentId);
    if (!deployment) throw new Error("Not found");

    // Tenant + relationship checks (defense in depth, aligns with ADR-0004 ownership checks too).
    if (deployment.userId !== userId) throw new Error("Not found");
    if (deployment.agentId !== agent._id) throw new Error("Not found");

    // Activation rules: only allow activating an "active" deployment record.
    // (If you want to allow "inactive" rollback targets later, keep a separate state machine.)
    if (deployment.status !== "active") {
      throw new Error("Deployment is not in an activatable state");
    }

    const now = Date.now();

    await ctx.db.patch(agent._id, {
      activeDeploymentId: deployment._id,
      status: "active",
      updatedAtMs: now,
    });

    await ctx.db.insert("auditLog", {
      userId,
      atMs: now,
      action: "deployment.activate",
      actor: {
        identitySubject: identity.subject ?? undefined,
      },
      meta: {
        agentId: agent._id,
        deploymentId: deployment._id,
        reason: normalizeOptionalReason(args.reason),
      },
    });

    const updatedAgent = await ctx.db.get(agent._id);
    if (!updatedAgent) throw new Error("Not found");
    return updatedAgent;
  },
});

async function getAgentOwnedOrThrow(
  ctx: { db: any },
  currentUserId: Id<"users">,
  agentId: Id<"agents">,
): Promise<Doc<"agents">> {
  const agent = (await ctx.db.get(agentId)) as Doc<"agents"> | null;
  if (!agent) throw new Error("Not found");
  if (agent.userId !== currentUserId) throw new Error("Not found"); // IDOR-safe
  return agent;
}

async function getNextDeploymentVersion(
  ctx: { db: any },
  agentId: Id<"agents">,
): Promise<number> {
  // We rely on the `by_agentId_version` index.
  // Convex supports ordering a query that uses an index; if this proves unreliable,
  // replace with a small "version counter" field on the agent row.
  const last = await ctx.db
    .query("deployments")
    .withIndex("by_agentId_version", (q: any) => q.eq("agentId", agentId))
    .order("desc")
    .first();

  const lastVersion = (last?.version ?? 0) as number;
  const next = lastVersion + 1;
  if (!Number.isInteger(next) || next <= 0)
    throw new Error("Invalid deployment version");
  return next;
}

function normalizeOptionalReason(
  reason: string | undefined,
): string | undefined {
  if (reason === undefined) return undefined;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 200) return trimmed.slice(0, 200);
  return trimmed;
}
