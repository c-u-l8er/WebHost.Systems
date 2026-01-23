/**
 * Control plane API client for the webhost.systems dashboard (Vite + React).
 *
 * Key property:
 * - Uses a Clerk JWT for authentication (via a caller-provided token getter).
 *
 * How to use with Clerk (example in a React component):
 *
 *   const { getToken } = useAuth();
 *   const client = new ControlPlaneClient({
 *     baseUrl: import.meta.env.VITE_CONTROL_PLANE_URL!,
 *     getToken: () => getToken(),
 *   });
 *
 * Notes:
 * - This wrapper is intentionally thin: it mirrors the Slice B endpoints implemented in `apps/control-plane/convex/http.ts`.
 * - It assumes JSON request/response bodies for non-streaming endpoints.
 * - For SSE streaming, it uses `fetch()` and parses the event stream manually because `EventSource`
 *   cannot send Authorization headers.
 */

export type ControlPlaneClientOptions = {
  /**
   * Base URL for the control plane HTTP API.
   * Example: "https://<deployment>.convex.site"
   */
  baseUrl: string;

  /**
   * Async function returning a Clerk JWT.
   * In React + Clerk, this is typically `useAuth().getToken`.
   *
   * Return null/undefined when not authenticated.
   */
  getToken: () => Promise<string | null | undefined>;

  /**
   * Optional default fetch init overrides (e.g. credentials policy).
   */
  defaultFetchInit?: RequestInit;
};

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
    requestId?: string;
  };
};

export type Agent = {
  _id: string;
  userId: string;

  name: string;
  description?: string;

  status:
    | "draft"
    | "ready"
    | "deploying"
    | "active"
    | "error"
    | "disabled"
    | "deleted";

  envVarKeys: string[];
  activeDeploymentId?: string;
  preferredRuntimeProvider?: "cloudflare" | "agentcore";

  createdAtMs: number;
  updatedAtMs: number;

  disabledAtMs?: number;
  deletedAtMs?: number;
};

export type Deployment = {
  _id: string;
  userId: string;
  agentId: string;

  version: number;
  protocol: "invoke/v1";
  runtimeProvider: "cloudflare" | "agentcore";
  status: "deploying" | "active" | "failed" | "inactive";

  artifact?: {
    type: string;
    ref?: string;
    checksum?: string;
  };

  providerRef?: unknown;
  telemetryAuthRef?: unknown;

  errorMessage?: string;
  logsRef?: unknown;

  createdAtMs: number;
  deployedAtMs?: number;
  finishedAtMs?: number;
};

export type InvokeV1MessageRole = "system" | "user" | "assistant" | "tool";
export type InvokeV1Message = { role: InvokeV1MessageRole; content: string };

export type InvokeV1Request = {
  protocol: "invoke/v1";
  traceId?: string;
  sessionId?: string;
  input: {
    prompt?: string;
    messages?: InvokeV1Message[];
  };
};

export type InvokeV1Response = {
  protocol: "invoke/v1";
  traceId: string;
  sessionId?: string;
  output: { text: string };
  usage?: {
    tokens?: number;
    computeMs?: number;
  };
};

export type CreateAgentRequest = {
  name: string;
  description?: string;
  envVarKeys?: string[];
  preferredRuntimeProvider?: "cloudflare" | "agentcore";
};

export type UpdateAgentRequest = {
  name?: string;
  description?: string;
  envVarKeys?: string[];
  preferredRuntimeProvider?: "cloudflare" | "agentcore";
};

export type DeployAgentRequest = {
  /**
   * Slice B: optional; if omitted, the control plane deploys a deterministic built-in template worker.
   */
  moduleCode?: string;
  runtimeProvider?: "cloudflare";
  compatibilityDate?: string;
  invokePath?: string;
  mainModuleName?: string;
};

export type ActivateDeploymentRequest = {
  reason?: string;
};

export type ListAgentsParams = {
  limit?: number;
  status?: Agent["status"];
  includeDeleted?: boolean;
};

export type ListDeploymentsParams = {
  limit?: number;
  status?: Deployment["status"];
  includeInactive?: boolean;
};

export type BillingUsage = {
  userId: string;
  periodKey: string;
  requests: number;
  llmTokens: number;
  computeMs: number;
  toolCalls: number;
  costUsdEstimated: number;
  updatedAtMs: number;
};

export type CurrentUsageResponse = {
  periodKey: string;
  tier: "free" | "pro" | "enterprise";
  usage: BillingUsage;
};

export type MetricsEvent = {
  _id: string;

  userId: string;
  agentId: string;
  deploymentId: string;

  runtimeProvider: "cloudflare" | "agentcore";

  eventId?: string;
  traceId?: string;

  timestampMs: number;

  requests: number;
  llmTokens: number;
  computeMs: number;
  toolCalls?: number;

  errors: number;
  errorClass?: "auth" | "limit" | "runtime" | "tool" | "unknown";

  costUsdEstimated: number;

  provider?: unknown;
};

export type RecentMetricsResponse = {
  events: MetricsEvent[];
};

export class ControlPlaneApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;
  public readonly retryable?: boolean;
  public readonly requestId?: string;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable?: boolean;
    requestId?: string;
  }) {
    super(args.message);
    this.name = "ControlPlaneApiError";
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.retryable = args.retryable;
    this.requestId = args.requestId;
  }
}

export type SseEvent<T = unknown> = {
  event: string;
  data: T;
};

export class ControlPlaneClient {
  private readonly baseUrl: string;
  private readonly getToken: ControlPlaneClientOptions["getToken"];
  private readonly defaultFetchInit?: RequestInit;

  constructor(options: ControlPlaneClientOptions) {
    const baseUrl = options.baseUrl?.trim();
    if (!baseUrl) throw new Error("ControlPlaneClient: baseUrl is required");

    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.getToken = options.getToken;
    this.defaultFetchInit = options.defaultFetchInit;
  }

  /* -------------------------------------------------------------------------------------------------
   * Agents
   * ------------------------------------------------------------------------------------------------- */

  async listAgents(
    params: ListAgentsParams = {},
    signal?: AbortSignal,
  ): Promise<Agent[]> {
    const q = new URLSearchParams();
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.status !== undefined) q.set("status", String(params.status));
    if (params.includeDeleted !== undefined)
      q.set("includeDeleted", String(params.includeDeleted));

    const path = q.toString() ? `/v1/agents?${q.toString()}` : "/v1/agents";
    const res = await this.requestJson<{ agents: Agent[] }>(
      "GET",
      path,
      undefined,
      signal,
    );
    return res.agents;
  }

  async createAgent(
    body: CreateAgentRequest,
    signal?: AbortSignal,
  ): Promise<Agent> {
    const res = await this.requestJson<{ agent: Agent }>(
      "POST",
      "/v1/agents",
      body,
      signal,
    );
    return res.agent;
  }

  async getAgent(agentId: string, signal?: AbortSignal): Promise<Agent> {
    const res = await this.requestJson<{ agent: Agent }>(
      "GET",
      `/v1/agents/${encodeURIComponent(agentId)}`,
      undefined,
      signal,
    );
    return res.agent;
  }

  async updateAgent(
    agentId: string,
    body: UpdateAgentRequest,
    signal?: AbortSignal,
  ): Promise<Agent> {
    const res = await this.requestJson<{ agent: Agent }>(
      "PATCH",
      `/v1/agents/${encodeURIComponent(agentId)}`,
      body,
      signal,
    );
    return res.agent;
  }

  async disableAgent(agentId: string, signal?: AbortSignal): Promise<Agent> {
    const res = await this.requestJson<{ agent: Agent }>(
      "POST",
      `/v1/agents/${encodeURIComponent(agentId)}/disable`,
      {},
      signal,
    );
    return res.agent;
  }

  async deleteAgent(agentId: string, signal?: AbortSignal): Promise<Agent> {
    const res = await this.requestJson<{ agent: Agent }>(
      "DELETE",
      `/v1/agents/${encodeURIComponent(agentId)}`,
      undefined,
      signal,
    );
    return res.agent;
  }

  /* -------------------------------------------------------------------------------------------------
   * Deployments
   * ------------------------------------------------------------------------------------------------- */

  async deployAgent(
    agentId: string,
    body: DeployAgentRequest = {},
    signal?: AbortSignal,
  ): Promise<Deployment> {
    const res = await this.requestJson<{ deployment: Deployment }>(
      "POST",
      `/v1/agents/${encodeURIComponent(agentId)}/deploy`,
      body,
      signal,
    );
    return res.deployment;
  }

  async activateDeployment(
    agentId: string,
    deploymentId: string,
    body: ActivateDeploymentRequest = {},
    signal?: AbortSignal,
  ): Promise<Agent> {
    const res = await this.requestJson<{ agent: Agent }>(
      "POST",
      `/v1/agents/${encodeURIComponent(agentId)}/deployments/${encodeURIComponent(deploymentId)}/activate`,
      body,
      signal,
    );
    return res.agent;
  }

  async listDeployments(
    agentId: string,
    params: ListDeploymentsParams = {},
    signal?: AbortSignal,
  ): Promise<Deployment[]> {
    const q = new URLSearchParams();
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    if (params.status !== undefined) q.set("status", String(params.status));
    if (params.includeInactive !== undefined)
      q.set("includeInactive", String(params.includeInactive));

    const path = q.toString()
      ? `/v1/agents/${encodeURIComponent(agentId)}/deployments?${q.toString()}`
      : `/v1/agents/${encodeURIComponent(agentId)}/deployments`;

    const res = await this.requestJson<{ deployments: Deployment[] }>(
      "GET",
      path,
      undefined,
      signal,
    );
    return res.deployments;
  }

  /* -------------------------------------------------------------------------------------------------
   * Invocation gateway
   * ------------------------------------------------------------------------------------------------- */

  async invoke(
    agentId: string,
    req: InvokeV1Request,
    signal?: AbortSignal,
  ): Promise<InvokeV1Response> {
    // Control plane currently returns the worker JSON "as-is" on success (Slice B).
    // We still type it as InvokeV1Response because that’s the intended contract.
    const res = await this.requestJson<InvokeV1Response>(
      "POST",
      `/v1/invoke/${encodeURIComponent(agentId)}`,
      req,
      signal,
    );
    return res;
  }

  /**
   * Invoke with SSE streaming (recommended by spec). Currently the control plane
   * emulates streaming by buffering one upstream response and emitting:
   * meta -> delta -> usage? -> done (or error).
   *
   * This returns an async generator of SSE events.
   */
  async *invokeStream(
    agentId: string,
    req: InvokeV1Request,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<SseEvent, void, void> {
    const token = await this.requireToken();
    const url = this.url(`/v1/invoke/${encodeURIComponent(agentId)}/stream`);

    const headers = new Headers();
    headers.set("authorization", `Bearer ${token}`);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("accept", "text/event-stream");

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
      signal: options.signal,
      ...this.defaultFetchInit,
    });

    if (!res.ok) {
      const text = await safeReadText(res);
      throw this.toApiError(res.status, text);
    }

    if (!res.body) {
      throw new Error("SSE response missing body");
    }

    yield* parseSseStream(res.body);
  }

  /* -------------------------------------------------------------------------------------------------
   * Usage + metrics (read)
   * ------------------------------------------------------------------------------------------------- */

  async getCurrentUsage(signal?: AbortSignal): Promise<CurrentUsageResponse> {
    return await this.requestJson<CurrentUsageResponse>(
      "GET",
      "/v1/usage/current",
      undefined,
      signal,
    );
  }

  async listRecentMetricsEvents(
    agentId: string,
    params: { sinceMs?: number; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<MetricsEvent[]> {
    const q = new URLSearchParams();
    q.set("agentId", agentId);
    if (params.sinceMs !== undefined) q.set("sinceMs", String(params.sinceMs));
    if (params.limit !== undefined) q.set("limit", String(params.limit));

    const res = await this.requestJson<RecentMetricsResponse>(
      "GET",
      `/v1/metrics/recent?${q.toString()}`,
      undefined,
      signal,
    );

    return res.events;
  }

  /* -------------------------------------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------------------------------------- */

  private url(path: string): string {
    if (!path.startsWith("/")) return `${this.baseUrl}/${path}`;
    return `${this.baseUrl}${path}`;
  }

  private async requireToken(): Promise<string> {
    const token = await this.getToken();
    if (!token) {
      throw new ControlPlaneApiError({
        status: 401,
        code: "UNAUTHORIZED",
        message: "Not authenticated",
        retryable: false,
      });
    }
    return token;
  }

  private async requestJson<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const token = await this.requireToken();
    const url = this.url(path);

    const headers = new Headers();
    headers.set("authorization", `Bearer ${token}`);
    headers.set("accept", "application/json");

    let requestBody: BodyInit | undefined = undefined;
    if (body !== undefined && method !== "GET") {
      headers.set("content-type", "application/json; charset=utf-8");
      requestBody = JSON.stringify(body);
    }

    const res = await fetch(url, {
      method,
      headers,
      body: requestBody,
      signal,
      ...this.defaultFetchInit,
    });

    const text = await safeReadText(res);

    if (!res.ok) {
      throw this.toApiError(res.status, text);
    }

    const parsed = safeParseJson(text);
    if (parsed === null) {
      // Some endpoints might return empty bodies; treat as error for JSON endpoints.
      throw new ControlPlaneApiError({
        status: 502,
        code: "BAD_GATEWAY",
        message: "Invalid JSON response from server",
        retryable: true,
      });
    }

    return parsed as T;
  }

  private toApiError(status: number, bodyText: string): ControlPlaneApiError {
    const maybe = safeParseJson(bodyText) as ApiErrorEnvelope | null;
    if (
      maybe &&
      typeof maybe === "object" &&
      maybe.error &&
      typeof maybe.error.code === "string"
    ) {
      return new ControlPlaneApiError({
        status,
        code: maybe.error.code,
        message: maybe.error.message || "Request failed",
        details: maybe.error.details,
        retryable: maybe.error.retryable,
        requestId: maybe.error.requestId,
      });
    }

    // Fallback: non-standard error
    return new ControlPlaneApiError({
      status,
      code: status === 401 ? "UNAUTHORIZED" : "REQUEST_FAILED",
      message: bodyText?.trim()
        ? bodyText.trim().slice(0, 500)
        : "Request failed",
      retryable: status >= 500,
    });
  }
}

/* -------------------------------------------------------------------------------------------------
 * SSE parsing (manual, fetch-based)
 * ------------------------------------------------------------------------------------------------- */

async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let currentEvent: { event?: string; dataLines: string[] } = { dataLines: [] };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE frames separated by blank line.
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
          } else {
            // Ignore other fields (id:, retry:, etc.) for now.
          }
        }

        const eventName = currentEvent.event ?? "message";
        const dataText = currentEvent.dataLines.join("\n");
        const data = safeParseJson(dataText) ?? dataText;

        yield { event: eventName, data };

        currentEvent = { dataLines: [] };
      }
    }

    // If we exit with partial buffered data, we ignore it (it wasn't a complete SSE event).
  } finally {
    reader.releaseLock();
  }
}

/* -------------------------------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------------------------------- */

function safeParseJson(text: string): any | null {
  try {
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
