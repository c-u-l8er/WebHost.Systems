"use node";

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
 * - TELEMETRY_SECRETS_ENCRYPTION_KEY   (32 bytes; base64/base64url or hex supported by crypto helper)
 * - CONTROL_PLANE_TELEMETRY_REPORT_URL (publicly reachable URL for POST /v1/telemetry/report)
 *
 * Public invocation URL strategy (choose one):
 *
 * A) workers.dev (fallback / simplest):
 * - CLOUDFLARE_WORKERS_DEV_SUBDOMAIN    (subdomain only, e.g. "trabur" for "trabur.workers.dev")
 *
 * B) Custom domain route (recommended / production-like):
 * - CLOUDFLARE_ZONE_ID                  (zone that owns the custom hostname, e.g. example.com)
 * - CLOUDFLARE_WORKERS_CUSTOM_DOMAIN    (host only, e.g. workers-api.example.com)
 *
 * Notes:
 * - Cloudflare secret bindings are used for both secrets and non-secret “deployment constants”
 *   (USER_ID/AGENT_ID/DEPLOYMENT_ID/TELEMETRY_REPORT_URL) to keep the adapter simple and avoid
 *   relying on provider-specific plaintext var/binding schemas in Slice B.
 */
export const deployCloudflareDeployment: any = internalAction({
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
  handler: async (ctx, args): Promise<any> => {
    const startedAtMs = Date.now();

    // Load deployment + agent (defense in depth).
    const deployment: any = await ctx.runQuery(
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

    const baseInvokePath = normalizeInvokePath(args.invokePath ?? "/invoke");

    // Optional custom domain routing:
    // - If configured, we route multiple deployments under one hostname by giving each deployment a unique path prefix:
    //   https://workers-api.example.com/dep/<deploymentId>/invoke
    // - If not configured, we fall back to workers.dev and the default invoke path (e.g. /invoke).
    const customDomain = getOptionalCustomDomainConfig();

    let routePrefix: string | null = null;
    let invokePath = baseInvokePath;
    let moduleCode = args.moduleCode;

    if (customDomain) {
      routePrefix = `/dep/${String(args.deploymentId)}`;
      invokePath = `${routePrefix}${baseInvokePath}`;

      // Rewrite the deterministic worker template's INVOKE_PATH constant so it matches the per-deployment invoke path.
      // This keeps Slice B "moduleCode optional" working even though moduleCode was generated earlier.
      moduleCode = rewriteInvokePathInWorkerModule(args.moduleCode, invokePath);
    }

    // Generate a stable-ish worker name based on ids; must be unique per deployment.
    const workerName = makeCloudflareWorkerName({
      agentId: String(args.agentId),
      deploymentId: String(args.deploymentId),
    });

    try {
      const { providerRef: providerRefFromAdapter, telemetryAuthRef } =
        await deployCloudflareWorker({
          workerName,
          moduleCode,
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

      // If custom domain routing is configured, create a per-deployment route and override invokeUrl to the custom hostname.
      // Otherwise, keep the workers.dev invokeUrl from the adapter.
      let providerRef: any = providerRefFromAdapter;

      if (customDomain) {
        if (!routePrefix) {
          throw new Error(
            "Internal error: missing routePrefix for custom domain deploy",
          );
        }

        const routePattern = `${customDomain.host}${routePrefix}/*`;

        await upsertCloudflareWorkerRoute({
          zoneId: customDomain.zoneId,
          token: requireEnv("CLOUDFLARE_API_TOKEN"),
          pattern: routePattern,
          script: workerName,
        });

        providerRef = {
          ...(providerRefFromAdapter as any),
          invokeUrl: `https://${customDomain.host}${invokePath}`,
          route: {
            type: "cloudflare.zoneRoute.v1",
            zoneId: customDomain.zoneId,
            pattern: routePattern,
            customDomainHost: customDomain.host,
          },
        };
      }

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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing ${name}`);
  return v.trim();
}

function getOptionalCustomDomainConfig(): {
  host: string;
  zoneId: string;
} | null {
  const rawHost = process.env.CLOUDFLARE_WORKERS_CUSTOM_DOMAIN;
  const rawZoneId = process.env.CLOUDFLARE_ZONE_ID;

  // Not configured: fall back to workers.dev.
  if ((!rawHost || !rawHost.trim()) && (!rawZoneId || !rawZoneId.trim())) {
    return null;
  }

  // Misconfigured: require both.
  if (!rawHost || !rawHost.trim() || !rawZoneId || !rawZoneId.trim()) {
    throw new Error(
      "Custom domain routing is partially configured. Set BOTH CLOUDFLARE_WORKERS_CUSTOM_DOMAIN and CLOUDFLARE_ZONE_ID, or set neither to use workers.dev.",
    );
  }

  return {
    host: normalizeCustomDomainHost(rawHost),
    zoneId: rawZoneId.trim(),
  };
}

function normalizeCustomDomainHost(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) throw new Error("Missing CLOUDFLARE_WORKERS_CUSTOM_DOMAIN");

  // Allow user to accidentally provide a URL; strip scheme if present.
  const withoutScheme = raw.replace(/^https?:\/\//, "");
  // Reject paths; host only.
  const host = withoutScheme.split("/")[0] ?? "";
  if (!host || host.includes(" "))
    throw new Error("Invalid CLOUDFLARE_WORKERS_CUSTOM_DOMAIN");
  return host;
}

/**
 * Best-effort rewrite of the generated worker module to change INVOKE_PATH.
 *
 * This keeps Slice B working without changing the deploy mutation that generated `moduleCode`.
 */
function rewriteInvokePathInWorkerModule(
  moduleCode: string,
  invokePath: string,
): string {
  const path = normalizeInvokePath(invokePath);

  // Match: const INVOKE_PATH = "....";
  const re = /const INVOKE_PATH = ("[^"]*"|'[^']*');/;
  if (!re.test(moduleCode)) {
    // If we can't rewrite, fail fast rather than deploying a worker that can't be invoked.
    throw new Error("Worker template missing INVOKE_PATH constant");
  }

  return moduleCode.replace(re, `const INVOKE_PATH = ${JSON.stringify(path)};`);
}

/**
 * Create (or ensure) a Workers route for a script on a custom domain.
 *
 * Route API:
 * - POST /zones/:zone_id/workers/routes   { pattern, script }
 *
 * Idempotency:
 * - If the route already exists, Cloudflare may return a 4xx. We treat "already exists" as success
 *   when possible by falling back to list+detect (best effort).
 */
async function upsertCloudflareWorkerRoute(args: {
  zoneId: string;
  token: string;
  pattern: string;
  script: string;
}): Promise<void> {
  const base = "https://api.cloudflare.com/client/v4";

  // First try: create route.
  {
    const res = await fetch(
      `${base}/zones/${encodeURIComponent(args.zoneId)}/workers/routes`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${args.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          pattern: args.pattern,
          script: args.script,
        }),
      },
    );

    const json = await safeParseCloudflareJson(res);
    if (res.ok && json?.success === true) return;

    // If create failed, fall through to "list and see if it already exists".
  }

  // Best-effort: list routes and see if the desired pattern already maps to this script.
  {
    const res = await fetch(
      `${base}/zones/${encodeURIComponent(args.zoneId)}/workers/routes`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${args.token}`,
        },
      },
    );

    const json = await safeParseCloudflareJson(res);
    const routes = Array.isArray(json?.result) ? json.result : [];
    const match = routes.find(
      (r: any) => r && r.pattern === args.pattern && r.script === args.script,
    );

    if (match) return;

    const firstError =
      Array.isArray(json?.errors) && json.errors.length > 0
        ? json.errors[0]
        : null;

    const code = firstError?.code;
    const message = firstError?.message;

    const suffixParts: string[] = [];
    suffixParts.push(`pattern=${args.pattern}`);
    if (code !== undefined && code !== null)
      suffixParts.push(`code=${String(code)}`);
    if (typeof message === "string" && message.trim()) {
      suffixParts.push(`message=${message.trim().slice(0, 200)}`);
    }

    throw new Error(
      `Failed to configure Cloudflare custom-domain route (${suffixParts.join(", ")})`,
    );
  }
}

async function safeParseCloudflareJson(res: Response): Promise<any | null> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
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
