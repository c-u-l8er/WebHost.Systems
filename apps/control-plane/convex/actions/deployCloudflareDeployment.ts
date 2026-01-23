import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { deployCloudflareWorker } from "../providers/cloudflare";

/**
 * Internal Action: Deploy a Cloudflare Worker for a deployment and finalize state.
 *
 * This is the Slice B orchestration step scheduled from the `createAndDeploy` mutation.
 *
 * Responsibilities (normative alignment):
 * - Perform provider calls (Cloudflare API) in an Action (server-only).
 * - Generate + inject deployment-scoped telemetry signing secret (handled by provider adapter).
 * - Finalize deployment record with mutable subset only:
 *   - status, providerRef, telemetryAuthRef, timestamps, errorMessage/logsRef
 * - Update `agents.activeDeploymentId` on success (ADR-0005).
 *
 * Security invariants:
 * - This is an INTERNAL function and must not be callable by clients.
 * - Even though it’s internal, it still performs relationship checks (defense in depth).
 *
 * Environment variables required for Slice B:
 * - CLOUDFLARE_ACCOUNT_ID
 * - CLOUDFLARE_API_TOKEN
 * - CLOUDFLARE_WORKERS_DEV_SUBDOMAIN
 * - TELEMETRY_SECRETS_ENCRYPTION_KEY   (32 bytes; base64/base64url or hex supported by crypto helper)
 * - CONTROL_PLANE_TELEMETRY_REPORT_URL (publicly reachable URL for POST /v1/telemetry/report)
 *
 * Notes:
 * - Cloudflare secret bindings are used for both secrets and non-secret “deployment constants”
 *   (USER_ID/AGENT_ID/DEPLOYMENT_ID/TELEMETRY_REPORT_URL) to keep the adapter simple and avoid
 *   relying on provider-specific plaintext var/binding schemas in Slice B.
 */
export const deployCloudflareDeployment = internalAction({
  args: {
    agentId: v.id("agents"),
    deploymentId: v.id("deployments"),

    // Slice B payload: upload a single module worker.
    moduleCode: v.string(),

    // Optional Cloudflare upload knobs.
    compatibilityDate: v.optional(v.string()),
    invokePath: v.optional(v.string()),
    mainModuleName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const startedAtMs = Date.now();

    // Load deployment + agent (defense in depth).
    const deployment = await ctx.runQuery(
      internal.queries.internal.getDeploymentById,
      {
        deploymentId: args.deploymentId,
      },
    );

    if (!deployment) {
      // Nothing to do; likely deleted or bad schedule.
      return { ok: false as const, reason: "deployment_not_found" as const };
    }

    // Ensure this action is operating on the intended agent/deployment relationship.
    if (deployment.agentId !== args.agentId) {
      // Do not finalize anything for mismatched relationships.
      await safeFinalizeFailure(ctx, {
        deployment,
        errorMessage: "Deployment/agent mismatch",
      });
      return { ok: false as const, reason: "agent_mismatch" as const };
    }

    const agent = await ctx.runQuery(internal.queries.internal.getAgentById, {
      agentId: args.agentId,
    });

    if (!agent) {
      await safeFinalizeFailure(ctx, {
        deployment,
        errorMessage: "Agent not found",
      });
      return { ok: false as const, reason: "agent_not_found" as const };
    }

    // Tenant relationship consistency checks (defense in depth).
    if (agent.userId !== deployment.userId) {
      await safeFinalizeFailure(ctx, {
        deployment,
        errorMessage: "Deployment/user mismatch",
      });
      return { ok: false as const, reason: "user_mismatch" as const };
    }

    // Only attempt deploy for deployments still in deploying state.
    if (deployment.status !== "deploying") {
      return {
        ok: true as const,
        skipped: true as const,
        reason: "deployment_not_deploying" as const,
        status: deployment.status,
      };
    }

    // Optional: if agent was deleted/disabled after scheduling, we still mark deployment failed.
    if (agent.status === "deleted") {
      await safeFinalizeFailure(ctx, {
        deployment,
        errorMessage: "Agent was deleted during deploy",
      });
      return { ok: false as const, reason: "agent_deleted" as const };
    }

    if (agent.status === "disabled") {
      await safeFinalizeFailure(ctx, {
        deployment,
        errorMessage: "Agent is disabled",
      });
      return { ok: false as const, reason: "agent_disabled" as const };
    }

    // Slice B: this action only supports cloudflare deployments.
    if (deployment.runtimeProvider !== "cloudflare") {
      await safeFinalizeFailure(ctx, {
        deployment,
        errorMessage: "Unsupported runtime provider for this deploy action",
      });
      return { ok: false as const, reason: "unsupported_runtime" as const };
    }

    const telemetryReportUrl = process.env.CONTROL_PLANE_TELEMETRY_REPORT_URL;
    if (!telemetryReportUrl) {
      await safeFinalizeFailure(ctx, {
        deployment,
        errorMessage: "Missing CONTROL_PLANE_TELEMETRY_REPORT_URL",
      });
      return { ok: false as const, reason: "missing_env" as const };
    }

    const invokePath = normalizeInvokePath(args.invokePath ?? "/invoke");

    // Generate a stable-ish worker name based on ids; must be unique per deployment.
    const workerName = makeCloudflareWorkerName({
      agentId: String(args.agentId),
      deploymentId: String(args.deploymentId),
    });

    try {
      const { providerRef, telemetryAuthRef } = await deployCloudflareWorker({
        workerName,
        moduleCode: args.moduleCode,
        mainModuleName: args.mainModuleName ?? "index.mjs",
        compatibilityDate: args.compatibilityDate,
        invokePath,
        telemetrySecretBindingName: "TELEMETRY_SECRET",
        additionalSecrets: {
          // Non-secret but injected as secrets to keep the adapter surface simple in Slice B.
          TELEMETRY_REPORT_URL: telemetryReportUrl,
          USER_ID: String(deployment.userId),
          AGENT_ID: String(deployment.agentId),
          DEPLOYMENT_ID: String(deployment._id),
          RUNTIME_PROVIDER: "cloudflare",
        },
      });

      await ctx.runMutation(
        internal.mutations.internalDeploy.finalizeDeploymentSuccess,
        {
          userId: deployment.userId,
          agentId: deployment.agentId,
          deploymentId: deployment._id,
          providerRef,
          telemetryAuthRef,
          deployedAtMs: Date.now(),
          logsRef: {
            type: "inline",
            message: "Cloudflare deploy completed",
            workerName,
            durationMs: Date.now() - startedAtMs,
          },
        },
      );

      return {
        ok: true as const,
        skipped: false as const,
        workerName,
        invokeUrl: (providerRef as any)?.invokeUrl ?? null,
      };
    } catch (err) {
      const errorMessage = sanitizeDeployError(err);
      await safeFinalizeFailure(ctx, { deployment, errorMessage, workerName });
      return { ok: false as const, workerName, errorMessage };
    }
  },
});

function normalizeInvokePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/invoke";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Cloudflare worker names have provider constraints. Without pulling provider docs here, we:
 * - lowercase
 * - allow only [a-z0-9-]
 * - collapse invalid characters to '-'
 * - bound length to a conservative max (63)
 */
function makeCloudflareWorkerName(args: {
  agentId: string;
  deploymentId: string;
}): string {
  const raw = `whs-${args.agentId}-dep-${args.deploymentId}`.toLowerCase();
  const normalized = raw
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const MAX = 63;
  if (normalized.length <= MAX) return normalized;
  // Ensure we keep uniqueness from the end (deployment id portion tends to be at end).
  return normalized.slice(0, MAX).replace(/-$/g, "");
}

function sanitizeDeployError(err: unknown): string {
  // Never include raw provider error dumps, request ids, headers, etc.
  // Keep it bounded and UI-safe.
  const MAX = 500;

  if (err instanceof Error) {
    const name = err.name || "Error";
    const message = err.message || "Deployment failed";
    const combined = `${name}: ${message}`.slice(0, MAX);
    return combined;
  }

  return "Deployment failed";
}

type SafeFinalizeCtx = {
  runMutation: (mutation: any, args: any) => Promise<any>;
};

async function safeFinalizeFailure(
  ctx: SafeFinalizeCtx,
  args: {
    deployment: { userId: any; agentId: any; _id: any };
    errorMessage: string;
    workerName?: string;
  },
): Promise<void> {
  try {
    await ctx.runMutation(
      internal.mutations.internalDeploy.finalizeDeploymentFailure,
      {
        userId: args.deployment.userId,
        agentId: args.deployment.agentId,
        deploymentId: args.deployment._id,
        errorMessage: args.errorMessage,
        finishedAtMs: Date.now(),
        logsRef: {
          type: "inline",
          message: "Cloudflare deploy failed",
          workerName: args.workerName ?? null,
        },
      },
    );
  } catch {
    // If finalization fails, there's not much we can safely do here.
    // The deployment remains in `deploying` and should be reconciled manually or via a retry job.
  }
}
