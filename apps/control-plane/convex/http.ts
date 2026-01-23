import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

import {
  HttpError,
  errorResponse,
  errorResponseFromUnknown,
  getRequestIdFromHeaders,
  jsonResponse,
} from "./lib/httpResponses";

import {
  decryptSecretV1,
  loadEncryptionKeyFromEnv,
  verifyTelemetrySignatureHeaderV1,
} from "./lib/crypto";

import { invokeCloudflareWorker } from "./providers/cloudflare";

const http = httpRouter();

/**
 * webhost.systems v1 — HTTP API surface (Slice B)
 *
 * Exposes:
 * - Agents CRUD
 * - Deploy (Cloudflare)
 * - Invoke (non-streaming + SSE "recommended" endpoint)
 * - Signed telemetry ingestion (deployment-scoped HMAC over raw bytes)
 *
 * Notes:
 * - This is a greenfield Slice B implementation. It prioritizes correctness and security invariants
 *   over completeness of every endpoint in `10_API_CONTRACTS.md`.
 * - Control-plane endpoints require authentication via `Authorization: Bearer <JWT>` (Clerk JWT
 *   template configured for Convex).
 * - Telemetry ingestion is NOT authenticated via user auth; it is authenticated via the
 *   deployment-scoped signature (ADR-0004).
 */

/* -------------------------------------------------------------------------------------------------
 * Routes
 * ------------------------------------------------------------------------------------------------- */

http.route({
  path: "/v1/agents",
  method: "GET",
  handler: httpAction(handleAgentsList),
});

http.route({
  path: "/v1/agents",
  method: "POST",
  handler: httpAction(handleAgentsCreate),
});

/**
 * Any nested agent routes:
 * - /v1/agents/:agentId
 * - /v1/agents/:agentId/disable
 * - /v1/agents/:agentId/deploy
 * - /v1/agents/:agentId/deployments/:deploymentId/activate
 */
http.route({
  pathPrefix: "/v1/agents/",
  method: "GET",
  handler: httpAction(handleAgentsSubroutes),
});

http.route({
  pathPrefix: "/v1/agents/",
  method: "PATCH",
  handler: httpAction(handleAgentsSubroutes),
});

http.route({
  pathPrefix: "/v1/agents/",
  method: "POST",
  handler: httpAction(handleAgentsSubroutes),
});

http.route({
  pathPrefix: "/v1/agents/",
  method: "DELETE",
  handler: httpAction(handleAgentsSubroutes),
});

/**
 * Invocation gateway:
 * - /v1/invoke/:agentId
 * - /v1/invoke/:agentId/stream
 */
http.route({
  pathPrefix: "/v1/invoke/",
  method: "POST",
  handler: httpAction(handleInvokeSubroutes),
});

/**
 * Telemetry ingestion:
 * - /v1/telemetry/report
 */
http.route({
  path: "/v1/telemetry/report",
  method: "POST",
  handler: httpAction(handleTelemetryReport),
});

/**
 * Usage + metrics read APIs (dashboard)
 */
http.route({
  path: "/v1/usage/current",
  method: "GET",
  handler: httpAction(handleUsageCurrent),
});

http.route({
  path: "/v1/metrics/recent",
  method: "GET",
  handler: httpAction(handleMetricsRecent),
});

/**
 * Basic preflight handler (optional, minimal). You can tighten origins later.
 * This is mostly useful for local dev/testing from browser clients.
 */
http.route({
  pathPrefix: "/v1/",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    const requestId = getRequestIdFromHeaders(request.headers);
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, requestId),
    });
  }),
});

export default http;

/* -------------------------------------------------------------------------------------------------
 * Agents
 * ------------------------------------------------------------------------------------------------- */

async function handleAgentsList(
  ctx: { runQuery: any; runMutation: any; auth: any },
  request: Request,
): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    await requireAuth(ctx);

    const url = new URL(request.url);
    const limit = parseOptionalInt(url.searchParams.get("limit"));
    const status = url.searchParams.get("status") ?? undefined;
    const includeDeleted = parseOptionalBool(
      url.searchParams.get("includeDeleted"),
    );

    const agents = await ctx.runQuery(api.queries.agents.listAgents, {
      limit: limit ?? undefined,
      status: status as any,
      includeDeleted: includeDeleted ?? undefined,
    });

    return jsonResponse(
      { agents },
      { status: 200, requestId, headers: corsHeaders(request, requestId) },
    );
  } catch (err) {
    return withCors(
      request,
      errorResponseFromUnknown(err, requestId),
      requestId,
    );
  }
}

async function handleAgentsCreate(
  ctx: { runMutation: any; auth: any },
  request: Request,
): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    await requireAuth(ctx);

    const body = await safeJson(request);

    const agent = await ctx.runMutation(api.mutations.agents.createAgent, {
      name: body?.name,
      description: body?.description,
      envVarKeys: body?.envVarKeys,
      preferredRuntimeProvider: body?.preferredRuntimeProvider,
    });

    return jsonResponse(
      { agent },
      { status: 201, requestId, headers: corsHeaders(request, requestId) },
    );
  } catch (err) {
    return withCors(
      request,
      errorResponseFromUnknown(err, requestId),
      requestId,
    );
  }
}

async function handleAgentsSubroutes(
  ctx: { runQuery: any; runMutation: any; auth: any; runAction?: any },
  request: Request,
): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    await requireAuth(ctx);

    const url = new URL(request.url);
    const segments = splitPath(url.pathname);

    // Expected base: ["v1", "agents", ...]
    if (
      segments.length < 3 ||
      segments[0] !== "v1" ||
      segments[1] !== "agents"
    ) {
      throw new HttpError({
        status: 404,
        code: "NOT_FOUND",
        message: "Not found",
      });
    }

    const agentId = segments[2];
    if (!agentId) {
      throw new HttpError({
        status: 400,
        code: "INVALID_REQUEST",
        message: "Missing agentId",
      });
    }

    // /v1/agents/:agentId
    if (segments.length === 3) {
      if (request.method === "GET") {
        const agent = await ctx.runQuery(api.queries.agents.getAgent, {
          agentId,
          includeDeleted: false,
        });
        if (!agent) {
          throw new HttpError({
            status: 404,
            code: "NOT_FOUND",
            message: "Agent not found",
          });
        }
        return jsonResponse(
          { agent },
          { status: 200, requestId, headers: corsHeaders(request, requestId) },
        );
      }

      if (request.method === "PATCH") {
        const body = await safeJson(request);
        const agent = await ctx.runMutation(api.mutations.agents.updateAgent, {
          agentId,
          name: body?.name,
          description: body?.description,
          envVarKeys: body?.envVarKeys,
          preferredRuntimeProvider: body?.preferredRuntimeProvider,
        });
        return jsonResponse(
          { agent },
          { status: 200, requestId, headers: corsHeaders(request, requestId) },
        );
      }

      if (request.method === "DELETE") {
        const agent = await ctx.runMutation(api.mutations.agents.deleteAgent, {
          agentId,
        });
        return jsonResponse(
          { agent },
          { status: 200, requestId, headers: corsHeaders(request, requestId) },
        );
      }

      throw new HttpError({
        status: 405,
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed",
      });
    }

    // /v1/agents/:agentId/disable
    if (segments.length === 4 && segments[3] === "disable") {
      if (request.method !== "POST") {
        throw new HttpError({
          status: 405,
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed",
        });
      }
      const agent = await ctx.runMutation(api.mutations.agents.disableAgent, {
        agentId,
      });
      return jsonResponse(
        { agent },
        { status: 200, requestId, headers: corsHeaders(request, requestId) },
      );
    }

    // /v1/agents/:agentId/deploy  (Slice B: Cloudflare only)
    if (segments.length === 4 && segments[3] === "deploy") {
      if (request.method !== "POST") {
        throw new HttpError({
          status: 405,
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed",
        });
      }

      const body = await safeJson(request);

      /**
       * Slice B deploy payload:
       * - moduleCode: string (required)
       * - runtimeProvider?: "cloudflare" (optional)
       * - compatibilityDate?: string
       * - invokePath?: string
       * - mainModuleName?: string
       */
      const deployment = await ctx.runMutation(
        api.mutations.deployments.createAndDeploy,
        {
          agentId,
          runtimeProvider: body?.runtimeProvider,
          moduleCode: body?.moduleCode,
          compatibilityDate: body?.compatibilityDate,
          invokePath: body?.invokePath,
          mainModuleName: body?.mainModuleName,
        },
      );

      return jsonResponse(
        { deployment },
        { status: 202, requestId, headers: corsHeaders(request, requestId) },
      );
    }

    // /v1/agents/:agentId/deployments  (list)
    if (segments.length === 4 && segments[3] === "deployments") {
      if (request.method !== "GET") {
        throw new HttpError({
          status: 405,
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed",
        });
      }

      const limit = parseOptionalInt(url.searchParams.get("limit"));
      const status = url.searchParams.get("status") ?? undefined;
      const includeInactive = parseOptionalBool(
        url.searchParams.get("includeInactive"),
      );

      const deployments = await ctx.runQuery(
        api.queries.deployments.listDeploymentsByAgent,
        {
          agentId,
          limit: limit ?? undefined,
          status: status as any,
          includeInactive: includeInactive ?? undefined,
        },
      );

      return jsonResponse(
        { deployments },
        { status: 200, requestId, headers: corsHeaders(request, requestId) },
      );
    }

    // /v1/agents/:agentId/deployments/:deploymentId/activate
    if (
      segments.length === 6 &&
      segments[3] === "deployments" &&
      segments[5] === "activate"
    ) {
      if (request.method !== "POST") {
        throw new HttpError({
          status: 405,
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed",
        });
      }
      const deploymentId = segments[4];
      const body = await safeJson(request);

      const agent = await ctx.runMutation(
        api.mutations.deployments.activateDeployment,
        {
          agentId,
          deploymentId,
          reason: body?.reason,
        },
      );

      return jsonResponse(
        { agent },
        { status: 200, requestId, headers: corsHeaders(request, requestId) },
      );
    }

    throw new HttpError({
      status: 404,
      code: "NOT_FOUND",
      message: "Not found",
    });
  } catch (err) {
    return withCors(
      request,
      errorResponseFromUnknown(err, requestId),
      requestId,
    );
  }
}

/* -------------------------------------------------------------------------------------------------
 * Invocation gateway (non-streaming + SSE)
 * ------------------------------------------------------------------------------------------------- */

async function handleInvokeSubroutes(
  ctx: { runQuery: any; runMutation: any; auth: any },
  request: Request,
): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    await requireAuth(ctx);

    const url = new URL(request.url);
    const segments = splitPath(url.pathname);

    // Expected base: ["v1", "invoke", :agentId, ("stream")?]
    if (
      segments.length < 3 ||
      segments[0] !== "v1" ||
      segments[1] !== "invoke"
    ) {
      throw new HttpError({
        status: 404,
        code: "NOT_FOUND",
        message: "Not found",
      });
    }

    const agentId = segments[2];
    const isStream = segments.length === 4 && segments[3] === "stream";

    const rawBodyText = await request.text();
    const invokeReq = safeParseJson(rawBodyText);

    // Ensure protocol marker for consistent downstream behavior.
    const traceId =
      (invokeReq?.traceId as string | undefined) ?? `trace_${cryptoRandomId()}`;
    const protocol = (invokeReq?.protocol as string | undefined) ?? "invoke/v1";

    if (protocol !== "invoke/v1") {
      throw new HttpError({
        status: 400,
        code: "INVALID_REQUEST",
        message: "Unsupported protocol",
        details: { protocol },
        retryable: false,
      });
    }

    // Resolve agent (ownership enforced by query) and active deployment.
    const agent = await ctx.runQuery(api.queries.agents.getAgent, {
      agentId,
      includeDeleted: false,
    });

    if (!agent) {
      throw new HttpError({
        status: 404,
        code: "NOT_FOUND",
        message: "Agent not found",
      });
    }

    if (agent.status === "disabled") {
      throw new HttpError({
        status: 403,
        code: "FORBIDDEN",
        message: "Agent is disabled",
        retryable: false,
      });
    }
    if (agent.status === "deleted") {
      throw new HttpError({
        status: 404,
        code: "NOT_FOUND",
        message: "Agent not found",
      });
    }

    const activeDeploymentId = agent.activeDeploymentId as string | undefined;
    if (!activeDeploymentId) {
      throw new HttpError({
        status: 409,
        code: "CONFLICT",
        message: "No active deployment",
        retryable: false,
      });
    }

    const deployment = await ctx.runQuery(
      internal.queries.internal.getDeploymentById,
      {
        deploymentId: activeDeploymentId as any,
      },
    );

    if (!deployment) {
      throw new HttpError({
        status: 409,
        code: "CONFLICT",
        message: "Active deployment not found",
        retryable: false,
      });
    }

    // Defense in depth: relationship consistency.
    if (
      deployment.userId !== agent.userId ||
      deployment.agentId !== agent._id
    ) {
      throw new HttpError({
        status: 409,
        code: "CONFLICT",
        message: "Active deployment mismatch",
        retryable: false,
      });
    }

    if (deployment.status !== "active") {
      throw new HttpError({
        status: 409,
        code: "CONFLICT",
        message: "Active deployment is not ready",
        details: { status: deployment.status },
        retryable: true,
      });
    }

    // Runtime dispatch (Slice B: Cloudflare only)
    if (deployment.runtimeProvider !== "cloudflare") {
      throw new HttpError({
        status: 403,
        code: "FORBIDDEN",
        message: "Runtime provider not enabled",
        details: { runtimeProvider: deployment.runtimeProvider },
        retryable: false,
      });
    }

    if (!deployment.providerRef) {
      throw new HttpError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Deployment missing provider reference",
        retryable: true,
      });
    }

    // Ensure body contains traceId (propagate to data plane)
    const forwardedBodyText = JSON.stringify({
      ...(invokeReq ?? {}),
      protocol: "invoke/v1",
      traceId,
    });

    if (!isStream) {
      const providerResp = await invokeCloudflareWorker({
        providerRef: deployment.providerRef as any,
        body: forwardedBodyText,
        traceId,
        timeoutMs: 60_000,
      });

      // Best-effort: pass through the worker response as JSON.
      // In a later pass, normalize to the public contract and map provider errors to the error envelope.
      const status = providerResp.status;
      const text = providerResp.bodyText;

      if (status >= 200 && status < 300) {
        const json = safeParseJson(text);
        return jsonResponse(json ?? { raw: text }, {
          status: 200,
          requestId,
          headers: corsHeaders(request, requestId),
        });
      }

      return errorResponse({
        status: 502,
        code: "RUNTIME_ERROR",
        message: "Invocation failed",
        details: {
          runtimeProvider: "cloudflare",
          upstreamStatus: status,
        },
        retryable: status >= 500,
        requestId,
        headers: corsHeaders(request, requestId),
      });
    }

    // SSE streaming (recommended): emulate streaming by buffering a single upstream response.
    // If/when the data plane supports true streaming, map it to delta events here.
    return sseResponse(
      async (send) => {
        await send("meta", {
          protocol: "invoke/v1",
          traceId,
          agentId: agent._id,
          deploymentId: deployment._id,
        });

        try {
          const providerResp = await invokeCloudflareWorker({
            providerRef: deployment.providerRef as any,
            body: forwardedBodyText,
            traceId,
            timeoutMs: 60_000,
          });

          if (providerResp.status < 200 || providerResp.status >= 300) {
            await send("error", {
              error: {
                code: "RUNTIME_ERROR",
                message: "Invocation failed",
                details: {
                  runtimeProvider: "cloudflare",
                  upstreamStatus: providerResp.status,
                },
                retryable: providerResp.status >= 500,
                requestId,
              },
            });
            return;
          }

          const payload = safeParseJson(providerResp.bodyText) ?? {
            raw: providerResp.bodyText,
          };

          // Emit one delta chunk if we can find output.text, otherwise send the raw payload.
          const outputText =
            (payload?.output &&
              typeof payload.output.text === "string" &&
              payload.output.text) ||
            (typeof payload?.text === "string" && payload.text) ||
            null;

          if (outputText !== null) {
            await send("delta", { text: outputText });
          } else {
            await send("delta", { text: JSON.stringify(payload) });
          }

          if (payload?.usage) {
            await send("usage", payload.usage);
          }

          await send("done", { ok: true });
        } catch (err) {
          const normalized = safeErrorEnvelopeFromUnknown(err, requestId);
          await send("error", normalized);
        }
      },
      corsHeaders(request, requestId),
    );
  } catch (err) {
    return withCors(
      request,
      errorResponseFromUnknown(err, requestId),
      requestId,
    );
  }
}

/* -------------------------------------------------------------------------------------------------
 * Usage + metrics read endpoints (dashboard support)
 * ------------------------------------------------------------------------------------------------- */
async function handleUsageCurrent(
  ctx: { runQuery: any; runMutation?: any; auth: any },
  request: Request,
): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    await requireAuth(ctx);

    const result = await ctx.runQuery(
      api.queries.usage.getCurrentPeriodUsage,
      {},
    );

    return jsonResponse(result, {
      status: 200,
      requestId,
      headers: corsHeaders(request, requestId),
    });
  } catch (err) {
    return withCors(
      request,
      errorResponseFromUnknown(err, requestId),
      requestId,
    );
  }
}

async function handleMetricsRecent(
  ctx: { runQuery: any; runMutation?: any; auth: any },
  request: Request,
): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    await requireAuth(ctx);

    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId");
    if (!agentId) {
      throw new HttpError({
        status: 400,
        code: "INVALID_REQUEST",
        message: "Missing agentId",
        retryable: false,
      });
    }

    const sinceMs = parseOptionalInt(url.searchParams.get("sinceMs"));
    const limit = parseOptionalInt(url.searchParams.get("limit"));

    const events = await ctx.runQuery(
      api.queries.metrics.listRecentMetricsEventsByAgent,
      {
        agentId,
        sinceMs: sinceMs ?? undefined,
        limit: limit ?? undefined,
      },
    );

    return jsonResponse(
      { events },
      {
        status: 200,
        requestId,
        headers: corsHeaders(request, requestId),
      },
    );
  } catch (err) {
    return withCors(
      request,
      errorResponseFromUnknown(err, requestId),
      requestId,
    );
  }
}

/* -------------------------------------------------------------------------------------------------
 * Telemetry ingestion (signed, deployment-scoped)
 * ------------------------------------------------------------------------------------------------- */

async function handleTelemetryReport(
  ctx: { runQuery: any; runMutation: any },
  request: Request,
): Promise<Response> {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    // IMPORTANT: telemetry does NOT use user auth.
    const deploymentIdHeader = request.headers.get("x-telemetry-deployment-id");
    const signatureHeader = request.headers.get("x-telemetry-signature");

    if (!deploymentIdHeader) {
      throw new HttpError({
        status: 400,
        code: "INVALID_REQUEST",
        message: "Missing X-Telemetry-Deployment-Id",
        retryable: false,
      });
    }

    if (!signatureHeader) {
      throw new HttpError({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Missing X-Telemetry-Signature",
        retryable: false,
      });
    }

    // Read raw bytes (ADR-0004: signature is computed over raw body bytes).
    const rawBodyBytes = new Uint8Array(await request.arrayBuffer());
    const rawBodyText = new TextDecoder().decode(rawBodyBytes);
    const body = safeParseJson(rawBodyText);

    if (!body || typeof body !== "object") {
      throw new HttpError({
        status: 400,
        code: "INVALID_REQUEST",
        message: "Invalid JSON",
        retryable: false,
      });
    }

    const deployment = await ctx.runQuery(
      internal.queries.internal.getDeploymentById,
      {
        deploymentId: deploymentIdHeader as any,
      },
    );

    if (!deployment) {
      // Do not reveal whether a deployment exists; treat as unauthorized.
      throw new HttpError({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Invalid telemetry credentials",
        retryable: false,
      });
    }

    const telemetryAuthRef = deployment.telemetryAuthRef as any;
    const encrypted = telemetryAuthRef?.encrypted;

    if (!encrypted || encrypted.v !== 1 || encrypted.alg !== "aes-256-gcm") {
      throw new HttpError({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Invalid telemetry credentials",
        retryable: false,
      });
    }

    const encryptionKey = loadEncryptionKeyFromEnv({
      envValue: process.env.TELEMETRY_SECRETS_ENCRYPTION_KEY,
      expectedBytes: 32,
    });

    const telemetrySecretBytes = await decryptSecretV1({
      encrypted,
      encryptionKey,
    });

    const ok = await verifyTelemetrySignatureHeaderV1({
      telemetrySecret: telemetrySecretBytes,
      rawBodyBytes,
      signatureHeader,
    });

    if (!ok) {
      // Audit log could be added later; keep response generic.
      throw new HttpError({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Invalid telemetry credentials",
        retryable: false,
      });
    }

    // Ownership cross-check (ADR-0004):
    // - deployment in header must match body.deploymentId
    // - deployment.userId/agentId must match body.userId/agentId
    const bodyUserId = (body as any).userId;
    const bodyAgentId = (body as any).agentId;
    const bodyDeploymentId = (body as any).deploymentId;
    const bodyRuntimeProvider = (body as any).runtimeProvider;

    if (
      typeof bodyUserId !== "string" ||
      typeof bodyAgentId !== "string" ||
      typeof bodyDeploymentId !== "string" ||
      typeof bodyRuntimeProvider !== "string"
    ) {
      throw new HttpError({
        status: 400,
        code: "INVALID_REQUEST",
        message: "Missing required attribution fields",
        retryable: false,
      });
    }

    if (bodyDeploymentId !== deploymentIdHeader) {
      throw new HttpError({
        status: 400,
        code: "INVALID_REQUEST",
        message: "deploymentId mismatch",
        retryable: false,
      });
    }

    if (
      deployment.userId !== bodyUserId ||
      deployment.agentId !== bodyAgentId
    ) {
      throw new HttpError({
        status: 403,
        code: "FORBIDDEN",
        message: "Telemetry attribution mismatch",
        retryable: false,
      });
    }

    if (deployment.runtimeProvider !== bodyRuntimeProvider) {
      throw new HttpError({
        status: 400,
        code: "INVALID_REQUEST",
        message: "runtimeProvider mismatch",
        retryable: false,
      });
    }

    // Parse numeric fields (keep strict and deterministic).
    const timestampMs = requireNumber((body as any).timestampMs, "timestampMs");
    const requests = requireNumber((body as any).requests, "requests");
    const llmTokens = requireNumber((body as any).llmTokens, "llmTokens");
    const computeMs = requireNumber((body as any).computeMs, "computeMs");
    const costUsdEstimated = requireNumber(
      (body as any).costUsdEstimated,
      "costUsdEstimated",
    );
    const errors = requireNumber((body as any).errors, "errors");

    const eventId =
      typeof (body as any).eventId === "string"
        ? (body as any).eventId
        : undefined;
    const traceId =
      typeof (body as any).traceId === "string"
        ? (body as any).traceId
        : undefined;
    const toolCalls = (body as any).toolCalls;
    const errorClass = (body as any).errorClass;
    const provider = (body as any).provider;

    const ingestResult = await ctx.runMutation(
      internal.mutations.internalTelemetry.ingestMetricsEvent,
      {
        userId: bodyUserId,
        agentId: bodyAgentId,
        deploymentId: bodyDeploymentId,
        runtimeProvider: bodyRuntimeProvider,
        eventId,
        traceId,
        timestampMs: Math.trunc(timestampMs),
        requests: Math.trunc(requests),
        llmTokens: Math.trunc(llmTokens),
        computeMs: Math.trunc(computeMs),
        toolCalls:
          typeof toolCalls === "number" ? Math.trunc(toolCalls) : undefined,
        errors: Math.trunc(errors),
        errorClass: typeof errorClass === "string" ? errorClass : undefined,
        costUsdEstimated,
        provider,
      },
    );

    // v1 ingestion response: minimal acknowledgment.
    return jsonResponse(
      {
        ok: true,
        deduped: !!ingestResult?.deduped,
        metricsEventId: ingestResult?.metricsEventId ?? null,
      },
      { status: 200, requestId },
    );
  } catch (err) {
    // Keep telemetry errors generic and non-leaky; still return normalized envelope.
    const res = errorResponseFromUnknown(err, requestId);
    return res;
  }
}

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------------------------------- */

async function requireAuth(ctx: {
  auth: any;
  runMutation?: any;
}): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new HttpError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Not authenticated",
      retryable: false,
    });
  }

  // Ensure the internal `users` record exists for this identity (tenant mapping).
  // This is a no-op if the user already exists.
  if (ctx.runMutation) {
    await ctx.runMutation(api.mutations.users.ensureCurrentUser, {});
  }
}

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

async function safeJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    throw new HttpError({
      status: 400,
      code: "INVALID_REQUEST",
      message: "Invalid JSON",
      retryable: false,
    });
  }
}

function safeParseJson(text: string): any | null {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function parseOptionalInt(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

function parseOptionalBool(value: string | null): boolean | null {
  if (value === null) return null;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function requireNumber(value: any, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError({
      status: 400,
      code: "INVALID_REQUEST",
      message: `Invalid ${field}`,
      retryable: false,
    });
  }
  return value;
}

/**
 * SSE helper (emulated streaming).
 *
 * Sends events with the schema:
 * - event: <type>
 * - data: <json>
 */
function sseResponse(
  handler: (send: (event: string, data: any) => Promise<void>) => Promise<void>,
  extraHeaders?: HeadersInit,
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = async (event: string, data: any) => {
        const payload =
          `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      (async () => {
        try {
          await handler(send);
        } finally {
          controller.close();
        }
      })().catch(async (err) => {
        try {
          await send("error", safeErrorEnvelopeFromUnknown(err));
        } finally {
          controller.close();
        }
      });
    },
  });

  const headers = new Headers(extraHeaders);
  headers.set("content-type", "text/event-stream; charset=utf-8");
  headers.set("cache-control", "no-cache");
  headers.set("connection", "keep-alive");
  headers.set("x-accel-buffering", "no");

  return new Response(stream, { status: 200, headers });
}

function safeErrorEnvelopeFromUnknown(err: unknown, requestId?: string): any {
  // Keep it generic and consistent with the error envelope shape.
  const message = err instanceof Error ? err.message : "Internal server error";

  return {
    error: {
      code: "INTERNAL_ERROR",
      message,
      requestId,
      retryable: true,
    },
  };
}

/**
 * Minimal CORS for dev convenience.
 * Tighten this once you know your dashboard origins and whether you want public invocation later.
 */
function corsHeaders(request: Request, requestId?: string): Headers {
  const h = new Headers();
  const origin = request.headers.get("origin") ?? "*";

  // In production, you should validate `origin` against an allowlist.
  h.set("access-control-allow-origin", origin);
  h.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  h.set(
    "access-control-allow-headers",
    "authorization,content-type,x-telemetry-deployment-id,x-telemetry-signature",
  );
  h.set("access-control-allow-credentials", "true");

  if (requestId) h.set("x-request-id", requestId);
  return h;
}

function withCors(
  request: Request,
  response: Response,
  requestId?: string,
): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request, requestId);
  for (const [k, v] of cors.entries()) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Use crypto.randomUUID() where available, but keep a fallback for environments that don’t expose it.
 */
function cryptoRandomId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return (
    Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
  );
}
