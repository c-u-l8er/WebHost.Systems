import { mutation } from "../_generated/server";
import { getOrCreateCurrentUser } from "../lib/auth";

/**
 * User provisioning (v1)
 *
 * Purpose:
 * - Ensure an internal `users` row exists for the authenticated identity (Clerk).
 *
 * Why this exists:
 * - Many other mutations/queries require a `users._id` to enforce tenant isolation.
 * - This provides an explicit "bootstrap" call the UI can trigger after sign-in.
 *
 * Security:
 * - Derives identity from `ctx.auth.getUserIdentity()` (server-authoritative).
 * - Ignores any client-supplied user identifiers (none accepted).
 */
export const ensureCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await getOrCreateCurrentUser(ctx);

    // Return the internal user record for convenience (safe fields only).
    // Note: This record intentionally does not contain any secret values.
    return { user };
  },
});
