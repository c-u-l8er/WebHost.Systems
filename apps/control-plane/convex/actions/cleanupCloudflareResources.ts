"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  deleteCloudflareResourcesForProviderRef,
  type CloudflareProviderRef,
} from "../providers/cloudflare";

/**
 * Internal Action: Best-effort Cloudflare resource cleanup for a deployment.
 *
 * What it cleans up (when present in providerRef):
 * - Custom-domain Workers route (zone route) created during deploy
 * - Worker script (the actual Worker)
 *
 * Notes:
 * - This is intentionally best-effort and safe to retry.
 * - This does NOT delete Convex rows; it only deletes Cloudflare-side resources.
 * - If your agent deletion flow currently deletes deployments before cleanup, you must
 *   run this action BEFORE deleting the deployment rows (or pass providerRef directly).
 */

/**
 * Cleanup Cloudflare resources for a deployment id (loads providerRef from DB).
 */
export const cleanupCloudflareResourcesForDeployment = internalAction({
  args: {
    deploymentId: v.id("deployments"),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<any> => {
    const deployment = await ctx.runQuery(
      (internal as any).queries.internal.getDeploymentById,
      { deploymentId: args.deploymentId },
    );

    if (!deployment) {
      return {
        ok: false as const,
        reason: "deployment_not_found" as const,
      };
    }

    if (deployment.runtimeProvider !== "cloudflare") {
      return {
        ok: true as const,
        skipped: true as const,
        reason: "not_cloudflare" as const,
        runtimeProvider: deployment.runtimeProvider,
      };
    }

    const providerRefUnknown = deployment.providerRef as unknown;

    if (!providerRefUnknown) {
      return {
        ok: false as const,
        reason: "missing_provider_ref" as const,
      };
    }

    if (!isCloudflareProviderRef(providerRefUnknown)) {
      return {
        ok: false as const,
        reason: "invalid_provider_ref" as const,
      };
    }

    if (args.dryRun) {
      return {
        ok: true as const,
        dryRun: true as const,
        workerName: providerRefUnknown.workerName,
        accountId: providerRefUnknown.accountId,
        hasRoute: !!providerRefUnknown.route,
        route: providerRefUnknown.route ?? null,
      };
    }

    try {
      const result = await deleteCloudflareResourcesForProviderRef({
        providerRef: providerRefUnknown,
      });

      return {
        ok: true as const,
        deletedRoutes: result.deletedRoutes,
        deletedScript: result.deletedScript,
        workerName: providerRefUnknown.workerName,
      };
    } catch (err) {
      return {
        ok: false as const,
        reason: "cleanup_failed" as const,
        errorMessage: summarizeError(err),
        workerName: providerRefUnknown.workerName,
      };
    }
  },
});

/**
 * Cleanup Cloudflare resources when you already have the providerRef (e.g. if the deployment row
 * is about to be deleted or has already been deleted).
 */
export const cleanupCloudflareResourcesForProviderRef = internalAction({
  args: {
    providerRef: v.any(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<any> => {
    const providerRefUnknown = args.providerRef as unknown;

    if (!isCloudflareProviderRef(providerRefUnknown)) {
      return {
        ok: false as const,
        reason: "invalid_provider_ref" as const,
      };
    }

    if (args.dryRun) {
      return {
        ok: true as const,
        dryRun: true as const,
        workerName: providerRefUnknown.workerName,
        accountId: providerRefUnknown.accountId,
        hasRoute: !!providerRefUnknown.route,
        route: providerRefUnknown.route ?? null,
      };
    }

    try {
      const result = await deleteCloudflareResourcesForProviderRef({
        providerRef: providerRefUnknown,
      });

      return {
        ok: true as const,
        deletedRoutes: result.deletedRoutes,
        deletedScript: result.deletedScript,
        workerName: providerRefUnknown.workerName,
      };
    } catch (err) {
      return {
        ok: false as const,
        reason: "cleanup_failed" as const,
        errorMessage: summarizeError(err),
        workerName: providerRefUnknown.workerName,
      };
    }
  },
});

function isCloudflareProviderRef(value: unknown): value is CloudflareProviderRef {
  if (!value || typeof value !== "object") return false;

  const v = value as any;

  if (v.runtimeProvider !== "cloudflare") return false;
  if (typeof v.accountId !== "string" || v.accountId.trim().length === 0)
    return false;
  if (typeof v.workerName !== "string" || v.workerName.trim().length === 0)
    return false;

  // Optional custom-domain route metadata (only validate shape if present)
  if (v.route !== undefined && v.route !== null) {
    if (typeof v.route !== "object") return false;
    if (v.route.type !== "cloudflare.zoneRoute.v1") return false;
    if (typeof v.route.zoneId !== "string" || v.route.zoneId.trim().length === 0)
      return false;
    if (
      typeof v.route.pattern !== "string" ||
      v.route.pattern.trim().length === 0
    )
      return false;
  }

  return true;
}

function summarizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
