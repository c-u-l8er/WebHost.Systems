import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { getOrCreateCurrentUser } from "../lib/auth";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Agent CRUD mutations (v1) with strict tenant ownership enforcement.
 *
 * Normative sources:
 * - project_spec/spec_v1/10_API_CONTRACTS.md (Agents API)
 * - project_spec/spec_v1/30_DATA_MODEL_CONVEX.md (ownership + server-only rules)
 *
 * Security invariants:
 * - Client-supplied `userId` is never accepted.
 * - Every mutation resolves the authenticated identity -> internal `users._id`.
 * - Access to an `agents` row is only permitted when `agent.userId === currentUserId`.
 * - For IDOR safety, "not found" is returned for both missing and not-owned resources.
 */

const runtimeProvider = v.union(
  v.literal("cloudflare"),
  v.literal("agentcore"),
);

export const createAgent = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    envVarKeys: v.optional(v.array(v.string())),
    preferredRuntimeProvider: v.optional(runtimeProvider),
  },
  handler: async (ctx, args) => {
    const { userId } = await getOrCreateCurrentUser(ctx);

    const now = Date.now();
    const name = normalizeName(args.name);

    const envVarKeys = normalizeEnvVarKeys(args.envVarKeys ?? []);

    const agentId = await ctx.db.insert("agents", {
      userId,

      name,
      description: normalizeOptionalText(args.description),

      status: "draft",

      envVarKeys,
      activeDeploymentId: undefined,
      preferredRuntimeProvider: args.preferredRuntimeProvider,

      createdAtMs: now,
      updatedAtMs: now,
      disabledAtMs: undefined,
      deletedAtMs: undefined,
    });

    const agent = await ctx.db.get(agentId);
    if (!agent) throw new Error("Failed to create agent");
    return agent;
  },
});

export const updateAgent = mutation({
  args: {
    agentId: v.id("agents"),

    name: v.optional(v.string()),
    description: v.optional(v.string()),

    /**
     * Replace the allowed secret keys list. Values are never stored in Convex.
     * This does NOT set secret values; those are write-only via a separate endpoint.
     */
    envVarKeys: v.optional(v.array(v.string())),

    preferredRuntimeProvider: v.optional(runtimeProvider),
  },
  handler: async (ctx, args) => {
    const { userId } = await getOrCreateCurrentUser(ctx);
    const agent = await getAgentOwnedOrThrow(ctx, userId, args.agentId);

    if (agent.status === "deleted") {
      throw new Error("Not found");
    }

    const patch: Partial<Doc<"agents">> = {
      updatedAtMs: Date.now(),
    };

    if (args.name !== undefined) {
      patch.name = normalizeName(args.name);
    }

    if (args.description !== undefined) {
      patch.description = normalizeOptionalText(args.description);
    }

    if (args.envVarKeys !== undefined) {
      patch.envVarKeys = normalizeEnvVarKeys(args.envVarKeys);
    }

    if (args.preferredRuntimeProvider !== undefined) {
      patch.preferredRuntimeProvider = args.preferredRuntimeProvider;
    }

    // No-op protection: require at least one meaningful field change besides updatedAtMs.
    const patchKeys = Object.keys(patch).filter((k) => k !== "updatedAtMs");
    if (patchKeys.length === 0) {
      throw new Error("No fields to update");
    }

    await ctx.db.patch(agent._id, patch);

    const updated = await ctx.db.get(agent._id);
    if (!updated) throw new Error("Not found");
    return updated;
  },
});

export const disableAgent = mutation({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const { userId } = await getOrCreateCurrentUser(ctx);
    const agent = await getAgentOwnedOrThrow(ctx, userId, args.agentId);

    if (agent.status === "deleted") {
      throw new Error("Not found");
    }

    const now = Date.now();

    await ctx.db.patch(agent._id, {
      status: "disabled",
      disabledAtMs: now,
      updatedAtMs: now,
    });

    const updated = await ctx.db.get(agent._id);
    if (!updated) throw new Error("Not found");
    return updated;
  },
});

export const deleteAgent = mutation({
  args: {
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const { userId } = await getOrCreateCurrentUser(ctx);
    const agent = await getAgentOwnedOrThrow(ctx, userId, args.agentId);

    if (agent.status === "deleted") {
      // Make delete idempotent-ish for client UX.
      return agent;
    }

    const now = Date.now();

    // v1 recommendation: soft-delete agent row. We also clear routing pointer to prevent invocations.
    // Do this BEFORE deleting deployments so the invocation gateway stops routing immediately.
    await ctx.db.patch(agent._id, {
      status: "deleted",
      deletedAtMs: now,
      updatedAtMs: now,
      activeDeploymentId: undefined,
    });

    // Cascade: remove all deployments for this agent.
    // This matches the dashboard expectation that deleting an agent also removes its deployments.
    //
    // Defense in depth: also scope deletes by the authenticated userId, even though agent ownership
    // already implies these deployments should be owned by the same user.
    //
    // Implementation note: delete in batches to avoid large collects for users with many deployments.
    //
    // Provider-side cleanup (Cloudflare):
    // - Best-effort delete Workers resources (routes + script) for each deployment that has a providerRef.
    // - We schedule cleanup BEFORE deleting the deployment rows, and we pass providerRef directly so
    //   cleanup can still run even after the DB rows are removed.
    const BATCH_SIZE = 100;

    while (true) {
      const batch = await ctx.db
        .query("deployments")
        .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
        .filter((q) => q.eq(q.field("userId"), userId))
        .take(BATCH_SIZE);

      if (batch.length === 0) break;

      for (const d of batch) {
        if (d.userId !== userId) {
          throw new Error(
            "Invariant violation: encountered non-owned deployment during agent delete",
          );
        }

        // Best-effort Cloudflare teardown (workers + optional custom-domain route).
        // If cleanup fails, we still proceed with deleting the deployment rows.
        if (
          d.runtimeProvider === "cloudflare" &&
          d.providerRef !== undefined &&
          d.providerRef !== null
        ) {
          try {
            await ctx.scheduler.runAfter(
              0,
              (internal as any)["actions/cleanupCloudflareResources"]
                .cleanupCloudflareResourcesForProviderRef,
              { providerRef: d.providerRef },
            );
          } catch {
            // Swallow scheduling errors; agent deletion should remain robust.
          }
        }

        await ctx.db.delete(d._id);
      }

      if (batch.length < BATCH_SIZE) break;
    }

    const updated = await ctx.db.get(agent._id);
    if (!updated) throw new Error("Not found");
    return updated;
  },
});

async function getAgentOwnedOrThrow(
  ctx: { db: any },
  currentUserId: Id<"users">,
  agentId: Id<"agents">,
): Promise<Doc<"agents">> {
  const agent = (await ctx.db.get(agentId)) as Doc<"agents"> | null;
  if (!agent) throw new Error("Not found");

  if (agent.userId !== currentUserId) {
    // IDOR safety: do not reveal existence.
    throw new Error("Not found");
  }

  return agent;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error("Agent name is required");
  if (trimmed.length > 80) throw new Error("Agent name is too long");
  return trimmed;
}

function normalizeOptionalText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalize and validate allowed secret key names (env var keys).
 *
 * Security note:
 * - These are just *key names*; secret *values* MUST NOT be stored in Convex.
 *
 * Pragmatic v1 validation:
 * - Uppercase letters, digits, underscore; must start with A-Z.
 * - Limit length and count to avoid abuse.
 */
function normalizeEnvVarKeys(keys: string[]): string[] {
  const MAX_KEYS = 50;
  const MAX_LEN = 64;
  const re = /^[A-Z][A-Z0-9_]*$/;

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of keys) {
    const key = raw.trim();
    if (!key) continue;

    if (key.length > MAX_LEN) {
      throw new Error(`Invalid envVarKeys entry: "${key}" is too long`);
    }
    if (!re.test(key)) {
      throw new Error(
        `Invalid envVarKeys entry: "${key}" must match ${re.toString()}`,
      );
    }

    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }

    if (out.length > MAX_KEYS) {
      throw new Error(`Too many envVarKeys (max ${MAX_KEYS})`);
    }
  }

  // Deterministic ordering for diff-friendly updates.
  out.sort((a, b) => a.localeCompare(b));
  return out;
}
