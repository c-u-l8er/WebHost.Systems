import type { UserIdentity } from "convex/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Server-side auth helpers.
 *
 * Purpose:
 * - Map Clerk identity (subject) to internal `users` records.
 * - Enforce the v1 rule: never trust client-supplied `userId` for authorization.
 *
 * Notes:
 * - This module intentionally throws generic Errors for auth failures.
 *   The HTTP layer (or calling function) should translate these into the normalized
 *   error envelope described in `project_spec/spec_v1/10_API_CONTRACTS.md`.
 */

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

export type CurrentUser = {
  userId: Id<"users">;
  user: Doc<"users">;
  identity: UserIdentity;
};

/**
 * Returns the authenticated identity or null if unauthenticated.
 */
export async function getAuthIdentity(ctx: Pick<AnyCtx, "auth">): Promise<UserIdentity | null> {
  return await ctx.auth.getUserIdentity();
}

/**
 * Returns the Clerk subject (identity.subject) or null if unauthenticated.
 */
export async function getIdentitySubject(ctx: Pick<AnyCtx, "auth">): Promise<string | null> {
  const identity = await getAuthIdentity(ctx);
  return identity?.subject ?? null;
}

/**
 * Requires an authenticated identity.
 */
export async function requireAuthIdentity(ctx: Pick<AnyCtx, "auth">): Promise<UserIdentity> {
  const identity = await getAuthIdentity(ctx);
  if (!identity) {
    throw new Error("Not authenticated");
  }
  if (!identity.subject) {
    // Defensive: Convex identity should always include a subject for JWT providers.
    throw new Error("Invalid identity");
  }
  return identity;
}

/**
 * Looks up the internal `users` record for the currently authenticated user.
 *
 * IMPORTANT:
 * - This does NOT create a user record if missing (queries are read-only).
 * - Use `getOrCreateCurrentUser` from mutations/actions to auto-provision.
 */
export async function getCurrentUser(
  ctx: Pick<QueryCtx, "auth" | "db">
): Promise<CurrentUser | null> {
  const identity = await getAuthIdentity(ctx);
  if (!identity) return null;

  const subject = identity.subject;
  const user = await ctx.db
    .query("users")
    .withIndex("by_identitySubject", (q) => q.eq("identitySubject", subject))
    .unique();

  if (!user) return null;

  return { userId: user._id, user, identity };
}

/**
 * Requires an internal `users` record for the current identity.
 *
 * For greenfield systems, you typically call `getOrCreateCurrentUser` once in a
 * server-only mutation/action (e.g., "users.upsertCurrent") and then use
 * `requireCurrentUser` in queries/mutations thereafter.
 */
export async function requireCurrentUser(
  ctx: Pick<QueryCtx, "auth" | "db">
): Promise<CurrentUser> {
  const current = await getCurrentUser(ctx);
  if (!current) {
    throw new Error("User not found");
  }
  return current;
}

/**
 * Creates the internal `users` record for the current identity if it doesn't exist.
 * Also keeps basic profile fields (email/displayName) up to date when available.
 *
 * MUST be called from a write-capable context (mutation/action).
 */
export async function getOrCreateCurrentUser(
  ctx: Pick<MutationCtx | ActionCtx, "auth" | "db">
): Promise<CurrentUser> {
  const identity = await requireAuthIdentity(ctx);
  const subject = identity.subject;

  const existing = await ctx.db
    .query("users")
    .withIndex("by_identitySubject", (q) => q.eq("identitySubject", subject))
    .unique();

  const now = Date.now();

  if (!existing) {
    const userId = await ctx.db.insert("users", {
      identitySubject: subject,
      email: identity.email ?? undefined,
      displayName: identity.name ?? undefined,
      tier: "free",
      tierUpdatedAtMs: now,
      createdAtMs: now,
      updatedAtMs: now,
    });

    const user = await ctx.db.get(userId);
    if (!user) {
      // Extremely defensive; insert should be readable immediately.
      throw new Error("Failed to create user");
    }
    return { userId, user, identity };
  }

  // Best-effort profile refresh. Never allow identity updates to change ownership;
  // ownership is strictly tied to `identitySubject`.
  const nextEmail = identity.email ?? undefined;
  const nextDisplayName = identity.name ?? undefined;

  const needsPatch =
    (nextEmail !== undefined && nextEmail !== existing.email) ||
    (nextDisplayName !== undefined && nextDisplayName !== existing.displayName);

  if (needsPatch) {
    await ctx.db.patch(existing._id, {
      email: nextEmail ?? existing.email,
      displayName: nextDisplayName ?? existing.displayName,
      updatedAtMs: now,
    });
    const updated = await ctx.db.get(existing._id);
    if (!updated) throw new Error("User not found");
    return { userId: updated._id, user: updated, identity };
  }

  // Always bump updatedAtMs on first touch? Not required; avoid noisy writes.
  return { userId: existing._id, user: existing, identity };
}

/**
 * Helper for tenant checks: ensures a resource is owned by the current user.
 *
 * IMPORTANT: This ignores any client-provided userId and uses the resolved internal userId.
 */
export function assertOwnedByUser(
  currentUserId: Id<"users">,
  resourceUserId: Id<"users">,
  resourceNameForError: string
): void {
  if (resourceUserId !== currentUserId) {
    // Keep message generic; the caller can map to a normalized NOT_FOUND to avoid leaking existence.
    throw new Error(`Not authorized to access ${resourceNameForError}`);
  }
}
