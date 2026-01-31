import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Internal user upsert for delegated invocation (server-to-server).
 *
 * Purpose:
 * - Resolve a delegated external identity (e.g. Clerk user id / subject) into a WHS `users` row.
 * - Create the user row if missing, so delegated systems can invoke on behalf of a user without
 *   requiring that user to have previously visited the WHS dashboard.
 *
 * Normative source:
 * - `project_spec/spec_v1/10_API_CONTRACTS.md` §10.3 "delegated invoke":
 *   server MUST resolve `delegation.externalUserId` -> WHS user row.
 *
 * Security:
 * - INTERNAL ONLY. Do not expose this to clients.
 * - Does not allow setting `tier` (tier is controlled by billing/webhooks).
 */
export const upsertUserByIdentitySubject = internalMutation({
  args: {
    /**
     * Stable external auth subject (Clerk user id / JWT subject).
     * In WHS schema this is stored as `users.identitySubject`.
     */
    identitySubject: v.string(),

    /**
     * Optional profile hints from the delegating system.
     * These are best-effort and MUST NOT be treated as authoritative for security decisions.
     */
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    userId: Id<"users">;
    created: boolean;
    user: Doc<"users">;
  }> => {
    const identitySubject = normalizeIdentitySubject(args.identitySubject);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_identitySubject", (q) =>
        q.eq("identitySubject", identitySubject),
      )
      .unique();

    const now = Date.now();

    if (!existing) {
      const userId = await ctx.db.insert("users", {
        identitySubject,
        email: normalizeOptionalEmail(args.email),
        displayName: normalizeOptionalDisplayName(args.displayName),

        // v1 default: free tier until billing/webhooks update it.
        tier: "free",
        tierUpdatedAtMs: now,

        createdAtMs: now,
        updatedAtMs: now,
      });

      const user = await ctx.db.get(userId);
      if (!user) throw new Error("Failed to create user");

      return { userId, created: true, user };
    }

    // Best-effort profile update only if provided + changed (avoid noisy writes).
    const nextEmail = normalizeOptionalEmail(args.email);
    const nextDisplayName = normalizeOptionalDisplayName(args.displayName);

    const patch: Partial<Pick<Doc<"users">, "email" | "displayName" | "updatedAtMs">> =
      {};

    if (nextEmail !== undefined && nextEmail !== existing.email) {
      patch.email = nextEmail;
    }
    if (
      nextDisplayName !== undefined &&
      nextDisplayName !== existing.displayName
    ) {
      patch.displayName = nextDisplayName;
    }

    if (Object.keys(patch).length > 0) {
      patch.updatedAtMs = now;
      await ctx.db.patch(existing._id, patch);

      const updated = await ctx.db.get(existing._id);
      if (!updated) throw new Error("User not found");
      return { userId: updated._id, created: false, user: updated };
    }

    return { userId: existing._id, created: false, user: existing };
  },
});

function normalizeIdentitySubject(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid identitySubject");
  const s = value.trim();
  if (s.length === 0) throw new Error("Invalid identitySubject");
  // Bound length to keep indices predictable and to reduce abuse surface.
  if (s.length > 256) throw new Error("Invalid identitySubject");
  return s;
}

function normalizeOptionalEmail(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (s.length === 0) return undefined;
  if (s.length > 320) return undefined; // RFC-ish practical bound
  return s;
}

function normalizeOptionalDisplayName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (s.length === 0) return undefined;
  if (s.length > 200) return s.slice(0, 200);
  return s;
}
