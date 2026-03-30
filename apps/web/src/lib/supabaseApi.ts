/**
 * Supabase API client for the webhost.systems dashboard.
 *
 * - Direct PostgREST for reads (agents, deployments, metrics, billing)
 * - RPC functions for transactional writes (create/update/disable/delete agent, billing, metrics)
 * - Edge Functions for server-only operations (deploy, activate, invoke, delegated-invoke, telemetry, billing-webhook)
 */

import { supabase } from "./supabaseClient";

// ---------------------------------------------------------------------------
// Types (Supabase-native, snake_case)
// ---------------------------------------------------------------------------

export type Agent = {
  id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  description: string | null;
  framework: string | null;
  runtime_provider: "cloudflare" | "agentcore" | "openrouter";
  status: "created" | "deploying" | "active" | "error" | "disabled";
  active_deployment_id: string | null;
  env_var_keys: string[];
  provider_config: Record<string, unknown>;
  system_prompt: string | null;
  model: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  last_deployed_at: string | null;
  last_invocation_at: string | null;
};

export type Deployment = {
  id: string;
  workspace_id: string;
  agent_id: string;
  version: number;
  runtime_provider: "cloudflare" | "agentcore" | "openrouter";
  status: "deploying" | "active" | "failed" | "rolled_back";
  commit_hash: string | null;
  artifact: Record<string, unknown>;
  manifest: Record<string, unknown> | null;
  provider_ref: Record<string, unknown>;
  error_message: string | null;
  logs_ref: Record<string, unknown> | null;
  idempotency_key: string | null;
  telemetry_auth_ref: Record<string, unknown> | null;
  deployed_by: string;
  created_at: string;
  updated_at: string;
  deployed_at: string | null;
  finished_at: string | null;
};

export type MetricsEvent = {
  id: string;
  workspace_id: string;
  agent_id: string;
  deployment_id: string | null;
  runtime_provider: "cloudflare" | "agentcore" | "openrouter";
  timestamp: string;
  requests: number;
  llm_tokens: number;
  compute_ms: number;
  errors: number;
  error_class: string | null;
  trace_id: string | null;
  provider: Record<string, unknown>;
  cost_usd_estimated: number;
  bucket_key: string | null;
  created_at: string;
};

export type BillingUsage = {
  id: string;
  workspace_id: string;
  period_key: string;
  period_start: string;
  period_end: string;
  totals: {
    requests?: number;
    tokens?: number;
    compute_ms?: number;
    cost_usd_estimated?: number;
  };
  by_runtime: Record<string, unknown>;
  last_aggregated_at: string;
  paid: boolean;
  created_at: string;
};

export type InvokeV1Request = {
  protocol: "invoke/v1";
  traceId?: string;
  sessionId?: string;
  input: {
    prompt?: string;
    messages?: Array<{ role: string; content: string }>;
  };
};

export type InvokeV1Response = {
  protocol: "invoke/v1";
  traceId: string;
  sessionId?: string;
  output: { text: string };
  usage?: { tokens?: number; computeMs?: number };
};

export type SseEvent<T = unknown> = {
  event: string;
  data: T;
};

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly retryable?: boolean;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.retryable = args.retryable;
  }
}


// ---------------------------------------------------------------------------
// PostgREST reads
// ---------------------------------------------------------------------------

export async function listAgents(
  workspaceId: string,
  params: { limit?: number; status?: string; includeDeleted?: boolean } = {},
): Promise<Agent[]> {
  let query = supabase
    .schema("webhost")
    .from("agents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (params.status) {
    query = query.eq("status", params.status);
  }

  if (!params.includeDeleted) {
    query = query.is("deleted_at", null);
  }

  if (params.limit) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw toApiError(error);
  return data as Agent[];
}

export async function getAgent(agentId: string): Promise<Agent> {
  const { data, error } = await supabase
    .schema("webhost")
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .single();

  if (error) throw toApiError(error);
  return data as Agent;
}

export async function listDeployments(
  agentId: string,
  params: { limit?: number; status?: string } = {},
): Promise<Deployment[]> {
  let query = supabase
    .schema("webhost")
    .from("deployments")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false });

  if (params.status) {
    query = query.eq("status", params.status);
  }

  if (params.limit) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw toApiError(error);
  return data as Deployment[];
}

export async function listRecentMetrics(
  agentId: string,
  params: { since?: string; limit?: number } = {},
): Promise<MetricsEvent[]> {
  let query = supabase
    .schema("webhost")
    .from("metrics_events")
    .select("*")
    .eq("agent_id", agentId)
    .order("timestamp", { ascending: false });

  if (params.since) {
    query = query.gte("timestamp", params.since);
  }

  if (params.limit) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw toApiError(error);
  return data as MetricsEvent[];
}

export async function getBillingUsage(
  workspaceId: string,
  periodKey?: string,
): Promise<BillingUsage | null> {
  const key = periodKey ?? currentPeriodKey();
  const { data, error } = await supabase
    .schema("webhost")
    .from("billing_usage")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("period_key", key)
    .maybeSingle();

  if (error) throw toApiError(error);
  return data as BillingUsage | null;
}

// ---------------------------------------------------------------------------
// RPC writes (call SQL functions in webhost schema)
// ---------------------------------------------------------------------------

export async function createAgent(args: {
  workspace_id: string;
  name: string;
  description?: string;
  runtime_provider?: "cloudflare" | "agentcore" | "openrouter";
  env_var_keys?: string[];
  system_prompt?: string;
  model?: string;
}): Promise<Agent> {
  const { data, error } = await supabase.rpc("create_agent", {
    p_workspace_id: args.workspace_id,
    p_name: args.name,
    p_description: args.description ?? null,
    p_runtime_provider: args.runtime_provider ?? "openrouter",
    p_env_var_keys: args.env_var_keys ?? [],
    p_system_prompt: args.system_prompt ?? null,
    p_model: args.model ?? null,
  });

  if (error) throw toApiError(error);
  return data as Agent;
}

export async function updateAgent(args: {
  agent_id: string;
  name?: string;
  description?: string;
  runtime_provider?: "cloudflare" | "agentcore" | "openrouter";
  env_var_keys?: string[];
  system_prompt?: string;
  model?: string;
}): Promise<Agent> {
  const { data, error } = await supabase.rpc("update_agent", {
    p_agent_id: args.agent_id,
    p_name: args.name ?? null,
    p_description: args.description ?? null,
    p_runtime_provider: args.runtime_provider ?? null,
    p_env_var_keys: args.env_var_keys ?? null,
    p_system_prompt: args.system_prompt ?? null,
    p_model: args.model ?? null,
  });

  if (error) throw toApiError(error);
  return data as Agent;
}

export async function disableAgent(agentId: string): Promise<Agent> {
  const { data, error } = await supabase.rpc("disable_agent", {
    p_agent_id: agentId,
  });

  if (error) throw toApiError(error);
  return data as Agent;
}

export async function deleteAgent(agentId: string): Promise<Agent> {
  const { data, error } = await supabase.rpc("delete_agent", {
    p_agent_id: agentId,
  });

  if (error) throw toApiError(error);
  return data as Agent;
}

// ---------------------------------------------------------------------------
// Edge Function calls (server-only operations)
// ---------------------------------------------------------------------------

export async function deployAgent(
  agentId: string,
  body: {
    moduleCode?: string;
    runtimeProvider?: "cloudflare";
    compatibilityDate?: string;
    invokePath?: string;
    mainModuleName?: string;
  } = {},
): Promise<Deployment> {
  const { data, error } = await supabase.functions.invoke("webhost-deploy", {
    body: { agentId, ...body },
  });

  if (error) throw toEdgeFnError(error);
  return data as Deployment;
}

export async function activateDeployment(
  agentId: string,
  deploymentId: string,
  body: { reason?: string } = {},
): Promise<Agent> {
  const { data, error } = await supabase.functions.invoke(
    "webhost-activate-deployment",
    { body: { agentId, deploymentId, ...body } },
  );

  if (error) throw toEdgeFnError(error);
  return data as Agent;
}

export async function invoke(
  agentId: string,
  req: InvokeV1Request,
): Promise<InvokeV1Response> {
  const { data, error } = await supabase.functions.invoke("webhost-invoke", {
    body: { agentId, ...req },
  });

  if (error) throw toEdgeFnError(error);
  return data as InvokeV1Response;
}

export async function* invokeStream(
  agentId: string,
  req: InvokeV1Request,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<SseEvent, void, void> {
  // Edge Functions support SSE via response streaming
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new ApiError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Not authenticated",
    });
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const url = `${supabaseUrl}/functions/v1/webhost-invoke`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({ agentId, ...req, stream: true }),
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError({
      status: res.status,
      code: "INVOKE_STREAM_ERROR",
      message: text || "Streaming invocation failed",
      retryable: res.status >= 500,
    });
  }

  if (!res.body) {
    throw new Error("SSE response missing body");
  }

  yield* parseSseStream(res.body);
}

// ---------------------------------------------------------------------------
// SSE parsing (reused from controlPlaneClient.ts)
// ---------------------------------------------------------------------------

async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let currentEvent: { event?: string; dataLines: string[] } = {
    dataLines: [],
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const idx = buffer.indexOf("\n\n");
        if (idx === -1) break;

        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const lines = frame.split("\n").map((l) => l.replace(/\r$/, ""));
        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent.event = line.slice("event:".length).trim();
          } else if (line.startsWith("data:")) {
            currentEvent.dataLines.push(line.slice("data:".length).trimStart());
          }
        }

        const eventName = currentEvent.event ?? "message";
        const dataText = currentEvent.dataLines.join("\n");
        let data: unknown;
        try {
          data = dataText ? JSON.parse(dataText) : dataText;
        } catch {
          data = dataText;
        }

        yield { event: eventName, data };
        currentEvent = { dataLines: [] };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentPeriodKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toApiError(error: any): ApiError {
  return new ApiError({
    status: error.code === "PGRST116" ? 404 : 500,
    code: error.code ?? "DB_ERROR",
    message: error.message ?? "Database error",
    retryable: false,
  });
}

function toEdgeFnError(error: any): ApiError {
  // Supabase FunctionsHttpError: status is on error.context (the Response object)
  // Supabase FunctionsRelayError/FunctionsFetchError: no status, just message
  const status =
    error?.context?.status ?? error?.status ?? 500;
  const name = error?.name ?? "";

  let message = error?.message ?? "Edge function error";

  // FunctionsHttpError wraps the response — try to extract the real error
  if (name === "FunctionsHttpError" && error?.context) {
    // The context is the parsed response body (JSON or text)
    const ctx = error.context;
    if (ctx?.error?.message) {
      message = ctx.error.message;
    } else if (typeof ctx === "string") {
      message = ctx;
    }
  }

  console.error("[EdgeFn]", name, status, message, error);

  return new ApiError({
    status,
    code: error?.context?.error?.code ?? "EDGE_FUNCTION_ERROR",
    message,
    retryable: status >= 500,
  });
}
