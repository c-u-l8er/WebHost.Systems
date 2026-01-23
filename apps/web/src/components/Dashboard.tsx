import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  ControlPlaneApiError,
  ControlPlaneClient,
  type Agent,
  type CurrentUsageResponse,
  type Deployment,
  type InvokeV1Request,
  type InvokeV1Response,
  type MetricsEvent,
  type SseEvent,
} from "../lib/controlPlaneClient";

/**
 * Dashboard UI (Slice B)
 *
 * Uses `ControlPlaneClient` for:
 * - Agents: list/create/update/disable/delete
 * - Deploy: deployAgent (Cloudflare)
 * - Invoke: non-streaming + SSE streaming
 * - Deployments: activateDeployment (rollback pointer flip)
 *
 * Telemetry:
 * - Slice B control plane implements *telemetry ingestion* but does not yet expose a public
 *   "list telemetry events" or "usage summary" HTTP endpoint.
 * - This UI therefore provides a "Telemetry (coming next)" panel that will automatically
 *   light up once those endpoints exist.
 */

type RuntimeProvider = "cloudflare" | "agentcore";

type TelemetryEvent = MetricsEvent;

type UsageSummary = CurrentUsageResponse;

type AsyncStatus = "idle" | "loading" | "success" | "error";

function formatMs(ms?: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function safeJsonParse(text: string): any | null {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeError(err: unknown): string {
  if (err instanceof ControlPlaneApiError) {
    const rid = err.requestId ? ` (requestId=${err.requestId})` : "";
    return `${err.code}: ${err.message}${rid}`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

async function readTextSafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export default function Dashboard(): React.ReactElement {
  const { getToken } = useAuth();

  const controlPlaneUrl = useMemo(() => {
    const raw = import.meta.env.VITE_CONTROL_PLANE_URL;
    return raw ? raw.replace(/\/+$/, "") : "";
  }, []);

  const client = useMemo(() => {
    if (!controlPlaneUrl) return null;

    return new ControlPlaneClient({
      baseUrl: controlPlaneUrl,
      getToken: async () => {
        // The Convex auth config uses applicationID: "convex".
        // If you created a Clerk JWT template named "convex", request it explicitly.
        // If not, you can remove `{ template: "convex" }` and rely on the default token.
        // Clerk React supports passing a template option here.
        return await getToken({ template: "convex" });
      },
    });
  }, [controlPlaneUrl, getToken]);

  /* -------------------------------------------------------------------------------------------------
   * Agents
   * ------------------------------------------------------------------------------------------------- */

  const [agentsStatus, setAgentsStatus] = useState<AsyncStatus>("idle");
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  const selectedAgent = useMemo(
    () => agents.find((a) => a._id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const refreshAgents = useCallback(async () => {
    if (!client) return;

    setAgentsStatus("loading");
    setAgentsError(null);

    try {
      const list = await client.listAgents({
        limit: 200,
        includeDeleted: false,
      });
      setAgents(list);

      if (list.length > 0) {
        // Keep selection stable; default to the newest agent.
        const stillExists =
          selectedAgentId && list.some((a) => a._id === selectedAgentId);
        if (!stillExists) {
          const newest = [...list].sort(
            (a, b) => b.createdAtMs - a.createdAtMs,
          )[0];
          setSelectedAgentId(newest._id);
        }
      } else {
        setSelectedAgentId("");
      }

      setAgentsStatus("success");
    } catch (err) {
      setAgentsStatus("error");
      setAgentsError(summarizeError(err));
    }
  }, [client, selectedAgentId]);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  const [createName, setCreateName] = useState("demo-agent");
  const [createDescription, setCreateDescription] = useState("");

  const [createStatus, setCreateStatus] = useState<AsyncStatus>("idle");
  const [createError, setCreateError] = useState<string | null>(null);

  const createAgent = useCallback(async () => {
    if (!client) return;

    const name = createName.trim();
    if (!name) {
      setCreateError("Name is required");
      setCreateStatus("error");
      return;
    }

    setCreateStatus("loading");
    setCreateError(null);

    try {
      const agent = await client.createAgent({
        name,
        description: createDescription.trim() || undefined,
        envVarKeys: [],
        preferredRuntimeProvider: "cloudflare",
      });

      // Optimistic insert + select
      setAgents((prev) => [agent, ...prev]);
      setSelectedAgentId(agent._id);

      setCreateStatus("success");
    } catch (err) {
      setCreateStatus("error");
      setCreateError(summarizeError(err));
    }
  }, [client, createDescription, createName]);

  /* -------------------------------------------------------------------------------------------------
   * Deploy
   * ------------------------------------------------------------------------------------------------- */

  const [deployStatus, setDeployStatus] = useState<AsyncStatus>("idle");
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<Deployment | null>(null);

  const [deployInvokePath, setDeployInvokePath] = useState("/invoke");
  const [deployCompatibilityDate, setDeployCompatibilityDate] =
    useState<string>("");

  const deploySelected = useCallback(async () => {
    if (!client) return;
    if (!selectedAgent) return;

    setDeployStatus("loading");
    setDeployError(null);
    setDeployResult(null);

    try {
      const deployment = await client.deployAgent(selectedAgent._id, {
        // Slice B: omit moduleCode to use the built-in deterministic worker template
        invokePath: deployInvokePath.trim() || undefined,
        compatibilityDate: deployCompatibilityDate.trim() || undefined,
      });

      setDeployResult(deployment);
      setDeployStatus("success");

      // Deploy finalization is async; refresh immediately and again shortly after.
      await refreshAgents();
      setTimeout(() => void refreshAgents(), 1500);
      setTimeout(() => void refreshAgents(), 3500);
    } catch (err) {
      setDeployStatus("error");
      setDeployError(summarizeError(err));
    }
  }, [
    client,
    deployCompatibilityDate,
    deployInvokePath,
    refreshAgents,
    selectedAgent,
  ]);

  /* -------------------------------------------------------------------------------------------------
   * Deployment activation / rollback (pointer flip)
   * ------------------------------------------------------------------------------------------------- */

  const [activateDeploymentId, setActivateDeploymentId] = useState("");
  const [activateStatus, setActivateStatus] = useState<AsyncStatus>("idle");
  const [activateError, setActivateError] = useState<string | null>(null);

  const activateDeployment = useCallback(
    async (deploymentIdOverride?: string) => {
      if (!client) return;
      if (!selectedAgent) return;

      const deploymentId = (
        deploymentIdOverride ?? activateDeploymentId
      ).trim();
      if (!deploymentId) return;

      setActivateStatus("loading");
      setActivateError(null);

      try {
        await client.activateDeployment(selectedAgent._id, deploymentId, {
          reason: "dashboard activation",
        });

        setActivateStatus("success");
        await refreshAgents();
      } catch (err) {
        setActivateStatus("error");
        setActivateError(summarizeError(err));
      }
    },
    [activateDeploymentId, client, refreshAgents, selectedAgent],
  );

  /* -------------------------------------------------------------------------------------------------
   * Invoke (non-streaming + SSE)
   * ------------------------------------------------------------------------------------------------- */

  const [invokePrompt, setInvokePrompt] = useState("hello");
  const [invokeSessionId, setInvokeSessionId] = useState<string>("");
  const [invokeStatus, setInvokeStatus] = useState<AsyncStatus>("idle");
  const [invokeError, setInvokeError] = useState<string | null>(null);

  const [invokeResponse, setInvokeResponse] = useState<InvokeV1Response | null>(
    null,
  );
  const [invokeRaw, setInvokeRaw] = useState<string>("");

  const [streamStatus, setStreamStatus] = useState<AsyncStatus>("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamText, setStreamText] = useState<string>("");
  const [streamMeta, setStreamMeta] = useState<any>(null);
  const [streamUsage, setStreamUsage] = useState<any>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const invokeSelected = useCallback(async () => {
    if (!client) return;
    if (!selectedAgent) return;

    setInvokeStatus("loading");
    setInvokeError(null);
    setInvokeResponse(null);
    setInvokeRaw("");

    try {
      const req: InvokeV1Request = {
        protocol: "invoke/v1",
        input: { prompt: invokePrompt },
      };

      const session = invokeSessionId.trim();
      if (session) req.sessionId = session;

      const resp = await client.invoke(selectedAgent._id, req);

      setInvokeResponse(resp);
      setInvokeRaw(stringifyJson(resp));
      setInvokeStatus("success");

      // Preserve session id if returned
      if (resp.sessionId) setInvokeSessionId(resp.sessionId);
    } catch (err) {
      setInvokeStatus("error");
      setInvokeError(summarizeError(err));
    }
  }, [client, invokePrompt, invokeSessionId, selectedAgent]);

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setStreamStatus("idle");
  }, []);

  const invokeSelectedStream = useCallback(async () => {
    if (!client) return;
    if (!selectedAgent) return;

    // Cancel any previous stream
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;

    setStreamStatus("loading");
    setStreamError(null);
    setStreamText("");
    setStreamMeta(null);
    setStreamUsage(null);

    try {
      const req: InvokeV1Request = {
        protocol: "invoke/v1",
        input: { prompt: invokePrompt },
      };

      const session = invokeSessionId.trim();
      if (session) req.sessionId = session;

      for await (const evt of client.invokeStream(selectedAgent._id, req, {
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break;
        handleSseEvent(evt);
      }

      if (!controller.signal.aborted) setStreamStatus("success");
    } catch (err) {
      if (!controller.signal.aborted) {
        setStreamStatus("error");
        setStreamError(summarizeError(err));
      }
    } finally {
      if (!controller.signal.aborted) {
        streamAbortRef.current = null;
      }
    }
  }, [client, invokePrompt, invokeSessionId, selectedAgent]);

  const handleSseEvent = (evt: SseEvent) => {
    if (evt.event === "meta") {
      setStreamMeta(evt.data);
      return;
    }
    if (evt.event === "delta") {
      const deltaText =
        (evt.data &&
          typeof (evt.data as any).text === "string" &&
          (evt.data as any).text) ||
        (typeof evt.data === "string" ? evt.data : "");
      if (deltaText) setStreamText((prev) => prev + deltaText);
      return;
    }
    if (evt.event === "usage") {
      setStreamUsage(evt.data);
      return;
    }
    if (evt.event === "error") {
      // Control plane emits `{ error: { ... } }` as data for error events
      setStreamError(stringifyJson(evt.data));
      setStreamStatus("error");
      return;
    }
    if (evt.event === "done") {
      return;
    }
  };

  /* -------------------------------------------------------------------------------------------------
   * Deployments list (read)
   * ------------------------------------------------------------------------------------------------- */
  const [deploymentsStatus, setDeploymentsStatus] =
    useState<AsyncStatus>("idle");
  const [deploymentsError, setDeploymentsError] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);

  const refreshDeployments = useCallback(async () => {
    if (!client) return;
    if (!selectedAgent) {
      setDeployments([]);
      setDeploymentsStatus("idle");
      setDeploymentsError(null);
      return;
    }

    setDeploymentsStatus("loading");
    setDeploymentsError(null);

    try {
      const list = await client.listDeployments(selectedAgent._id, {
        includeInactive: true,
        limit: 50,
      });
      setDeployments(list);
      setDeploymentsStatus("success");
    } catch (err) {
      setDeploymentsStatus("error");
      setDeploymentsError(summarizeError(err));
    }
  }, [client, selectedAgent]);

  /* -------------------------------------------------------------------------------------------------
   * Telemetry (live; read endpoints are now available)
   * ------------------------------------------------------------------------------------------------- */

  const [usageStatus, setUsageStatus] = useState<AsyncStatus>("idle");
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const [eventsStatus, setEventsStatus] = useState<AsyncStatus>("idle");
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);

  const refreshUsageAndTelemetry = useCallback(async () => {
    if (!client) return;

    setUsageStatus("loading");
    setUsageError(null);

    setEventsStatus("loading");
    setEventsError(null);

    try {
      const usageResult = await client.getCurrentUsage();
      setUsage(usageResult);
      setUsageStatus("success");
    } catch (err) {
      setUsageStatus("error");
      setUsageError(summarizeError(err));
    }

    try {
      if (!selectedAgent) {
        setEvents([]);
        setEventsStatus("error");
        setEventsError("Select an agent to load telemetry events.");
        return;
      }

      const sinceMs = Date.now() - 60 * 60 * 1000; // last hour
      const recent = await client.listRecentMetricsEvents(selectedAgent._id, {
        sinceMs,
        limit: 50,
      });

      setEvents(recent);
      setEventsStatus("success");
    } catch (err) {
      setEventsStatus("error");
      setEventsError(summarizeError(err));
    }
  }, [client, selectedAgent]);

  // Refresh deployments and telemetry when selection changes.
  useEffect(() => {
    void refreshDeployments();
    void refreshUsageAndTelemetry();
  }, [refreshDeployments, refreshUsageAndTelemetry]);

  // Live telemetry polling (best-effort).
  useEffect(() => {
    if (!client) return;
    const id = setInterval(() => {
      void refreshUsageAndTelemetry();
    }, 5000);
    return () => clearInterval(id);
  }, [client, refreshUsageAndTelemetry]);

  /* -------------------------------------------------------------------------------------------------
   * Render
   * ------------------------------------------------------------------------------------------------- */

  const canUseApi = !!client;

  return (
    <div className="container">
      <div className="panel">
        <div className="panel-header">
          <div className="row">
            <div className="brand">
              <div className="brand-title">Dashboard</div>
              <div className="brand-subtitle">
                Slice B — Cloudflare deploy + invoke + signed telemetry
                ingestion
              </div>
            </div>
            <div className="spacer" />
            <span className="badge">
              <span className="muted">control plane</span>{" "}
              <code>{controlPlaneUrl || "(set VITE_CONTROL_PLANE_URL)"}</code>
            </span>
            <button
              className="button"
              onClick={() => void refreshAgents()}
              disabled={!canUseApi || agentsStatus === "loading"}
            >
              {agentsStatus === "loading" ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="panel-body">
          {!controlPlaneUrl ? (
            <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
              <div className="muted">
                Set <code>VITE_CONTROL_PLANE_URL</code> in{" "}
                <code>.env.local</code> to your Convex HTTP base URL (e.g.{" "}
                <code>https://&lt;deployment&gt;.convex.site</code>).
              </div>
            </div>
          ) : null}

          {agentsError ? (
            <div style={{ marginBottom: 12 }}>
              <div
                className="badge"
                style={{
                  borderColor: "rgba(255, 107, 107, 0.6)",
                  background: "rgba(255, 107, 107, 0.08)",
                }}
              >
                <span style={{ color: "var(--danger)" }}>Agents error:</span>{" "}
                <span>{agentsError}</span>
              </div>
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "380px 1fr",
              gap: 12,
              alignItems: "start",
            }}
          >
            {/* Left column: Agents */}
            <section className="panel">
              <div className="panel-header">
                <div className="row">
                  <strong>Agents</strong>
                  <div className="spacer" />
                  <span className="muted">{agents.length} total</span>
                </div>
              </div>

              <div className="panel-body">
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <label className="muted" style={{ fontSize: 12 }}>
                    Select agent
                  </label>
                  <select
                    value={selectedAgentId}
                    onChange={(e) => setSelectedAgentId(e.target.value)}
                    className="button"
                    style={{ textAlign: "left" }}
                    disabled={!canUseApi || agents.length === 0}
                  >
                    {agents.length === 0 ? (
                      <option value="" disabled>
                        No agents
                      </option>
                    ) : null}
                    {agents
                      .slice()
                      .sort((a, b) => b.createdAtMs - a.createdAtMs)
                      .map((a) => (
                        <option key={a._id} value={a._id}>
                          {a.name} — {a.status}
                        </option>
                      ))}
                  </select>

                  <div style={{ marginTop: 10 }}>
                    <strong>Create agent</strong>
                  </div>

                  <label className="muted" style={{ fontSize: 12 }}>
                    Name
                  </label>
                  <input
                    className="button"
                    style={{ width: "100%", textAlign: "left" }}
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="demo-agent"
                    disabled={!canUseApi || createStatus === "loading"}
                  />

                  <label className="muted" style={{ fontSize: 12 }}>
                    Description (optional)
                  </label>
                  <input
                    className="button"
                    style={{ width: "100%", textAlign: "left" }}
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    placeholder="A minimal agent"
                    disabled={!canUseApi || createStatus === "loading"}
                  />

                  <button
                    className="button button-primary"
                    onClick={() => void createAgent()}
                    disabled={!canUseApi || createStatus === "loading"}
                  >
                    {createStatus === "loading" ? "Creating…" : "Create"}
                  </button>

                  {createError ? (
                    <div className="muted" style={{ color: "var(--danger)" }}>
                      {createError}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {/* Right column: Selected agent actions */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <section className="panel">
                <div className="panel-header">
                  <div className="row">
                    <strong>Selected agent</strong>
                    <div className="spacer" />
                    {selectedAgent ? (
                      <span className="badge">
                        <span className="muted">status</span>{" "}
                        {selectedAgent.status}
                      </span>
                    ) : (
                      <span className="badge">
                        <span className="muted">none selected</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="panel-body">
                  {!selectedAgent ? (
                    <div className="muted">
                      Select an agent to deploy/invoke.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          Agent ID
                        </div>
                        <div>
                          <code>{selectedAgent._id}</code>
                        </div>

                        <div style={{ height: 8 }} />

                        <div className="muted" style={{ fontSize: 12 }}>
                          Active deployment
                        </div>
                        <div>
                          <code>
                            {selectedAgent.activeDeploymentId ?? "(none)"}
                          </code>
                        </div>
                      </div>

                      <div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          Created
                        </div>
                        <div>{formatMs(selectedAgent.createdAtMs)}</div>

                        <div style={{ height: 8 }} />

                        <div className="muted" style={{ fontSize: 12 }}>
                          Updated
                        </div>
                        <div>{formatMs(selectedAgent.updatedAtMs)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div className="row">
                    <strong>Deploy (Cloudflare)</strong>
                    <div className="spacer" />
                    <span className="badge">
                      <span className="muted">Slice B</span> template worker
                    </span>
                  </div>
                </div>

                <div className="panel-body">
                  {!selectedAgent ? (
                    <div className="muted">Select an agent to deploy.</div>
                  ) : (
                    <>
                      <div
                        className="muted"
                        style={{ fontSize: 12, marginBottom: 10 }}
                      >
                        This deploy uses the built-in deterministic Cloudflare
                        Worker template unless you add artifact packaging later.
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 10,
                        }}
                      >
                        <div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            invokePath
                          </div>
                          <input
                            className="button"
                            style={{ width: "100%", textAlign: "left" }}
                            value={deployInvokePath}
                            onChange={(e) =>
                              setDeployInvokePath(e.target.value)
                            }
                            placeholder="/invoke"
                            disabled={!canUseApi || deployStatus === "loading"}
                          />
                        </div>

                        <div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            compatibilityDate (optional)
                          </div>
                          <input
                            className="button"
                            style={{ width: "100%", textAlign: "left" }}
                            value={deployCompatibilityDate}
                            onChange={(e) =>
                              setDeployCompatibilityDate(e.target.value)
                            }
                            placeholder="2026-01-01"
                            disabled={!canUseApi || deployStatus === "loading"}
                          />
                        </div>
                      </div>

                      <div style={{ height: 10 }} />

                      <div className="row">
                        <button
                          className="button button-primary"
                          onClick={() => void deploySelected()}
                          disabled={!canUseApi || deployStatus === "loading"}
                        >
                          {deployStatus === "loading" ? "Deploying…" : "Deploy"}
                        </button>

                        {deployError ? (
                          <span
                            className="badge"
                            style={{
                              borderColor: "rgba(255, 107, 107, 0.6)",
                              background: "rgba(255, 107, 107, 0.08)",
                            }}
                          >
                            <span style={{ color: "var(--danger)" }}>
                              error
                            </span>{" "}
                            {deployError}
                          </span>
                        ) : null}
                      </div>

                      {deployResult ? (
                        <div style={{ marginTop: 12 }}>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Deployment created (async finalize)
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              marginTop: 6,
                              padding: 10,
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              background: "rgba(0,0,0,0.25)",
                              overflowX: "auto",
                              maxHeight: 220,
                            }}
                          >
                            {stringifyJson(deployResult)}
                          </pre>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div className="row">
                    <strong>Invoke</strong>
                    <div className="spacer" />
                    <span className="badge">
                      <span className="muted">protocol</span> invoke/v1
                    </span>
                  </div>
                </div>

                <div className="panel-body">
                  {!selectedAgent ? (
                    <div className="muted">Select an agent to invoke.</div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 10,
                        }}
                      >
                        <div style={{ gridColumn: "span 2" }}>
                          <div className="muted" style={{ fontSize: 12 }}>
                            prompt
                          </div>
                          <textarea
                            className="button"
                            style={{
                              width: "100%",
                              textAlign: "left",
                              minHeight: 90,
                              resize: "vertical",
                              fontFamily: "var(--mono)",
                            }}
                            value={invokePrompt}
                            onChange={(e) => setInvokePrompt(e.target.value)}
                            placeholder="hello"
                            disabled={
                              !canUseApi ||
                              invokeStatus === "loading" ||
                              streamStatus === "loading"
                            }
                          />
                        </div>

                        <div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            sessionId (optional, opaque)
                          </div>
                          <input
                            className="button"
                            style={{ width: "100%", textAlign: "left" }}
                            value={invokeSessionId}
                            onChange={(e) => setInvokeSessionId(e.target.value)}
                            placeholder="sess_..."
                            disabled={
                              !canUseApi ||
                              invokeStatus === "loading" ||
                              streamStatus === "loading"
                            }
                          />
                        </div>

                        <div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            streaming
                          </div>
                          <div className="row">
                            <button
                              className="button"
                              onClick={() => void invokeSelected()}
                              disabled={
                                !canUseApi ||
                                invokeStatus === "loading" ||
                                streamStatus === "loading"
                              }
                            >
                              {invokeStatus === "loading"
                                ? "Invoking…"
                                : "Invoke"}
                            </button>

                            <button
                              className="button"
                              onClick={() => void invokeSelectedStream()}
                              disabled={
                                !canUseApi ||
                                streamStatus === "loading" ||
                                invokeStatus === "loading"
                              }
                            >
                              {streamStatus === "loading"
                                ? "Streaming…"
                                : "Invoke (SSE)"}
                            </button>

                            {streamStatus === "loading" ? (
                              <button
                                className="button"
                                onClick={stopStreaming}
                              >
                                Stop
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {invokeError || streamError ? (
                        <div style={{ marginTop: 10 }}>
                          <div
                            className="badge"
                            style={{
                              borderColor: "rgba(255, 107, 107, 0.6)",
                              background: "rgba(255, 107, 107, 0.08)",
                            }}
                          >
                            <span style={{ color: "var(--danger)" }}>
                              error
                            </span>{" "}
                            {invokeError ?? streamError}
                          </div>
                        </div>
                      ) : null}

                      {invokeResponse ? (
                        <div style={{ marginTop: 12 }}>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Non-streaming response
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              marginTop: 6,
                              padding: 10,
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              background: "rgba(0,0,0,0.25)",
                              overflowX: "auto",
                              maxHeight: 240,
                            }}
                          >
                            {invokeRaw || stringifyJson(invokeResponse)}
                          </pre>
                        </div>
                      ) : null}

                      {streamStatus !== "idle" ? (
                        <div style={{ marginTop: 12 }}>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Stream
                          </div>

                          {streamMeta ? (
                            <pre
                              style={{
                                margin: 0,
                                marginTop: 6,
                                padding: 10,
                                border: "1px solid var(--border)",
                                borderRadius: 10,
                                background: "rgba(0,0,0,0.22)",
                                overflowX: "auto",
                                maxHeight: 180,
                              }}
                            >
                              {"[meta]\n" + stringifyJson(streamMeta)}
                            </pre>
                          ) : null}

                          <pre
                            style={{
                              margin: 0,
                              marginTop: 6,
                              padding: 10,
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              background: "rgba(0,0,0,0.25)",
                              overflowX: "auto",
                              maxHeight: 240,
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {streamText || "—"}
                          </pre>

                          {streamUsage ? (
                            <pre
                              style={{
                                margin: 0,
                                marginTop: 6,
                                padding: 10,
                                border: "1px solid var(--border)",
                                borderRadius: 10,
                                background: "rgba(0,0,0,0.22)",
                                overflowX: "auto",
                                maxHeight: 180,
                              }}
                            >
                              {"[usage]\n" + stringifyJson(streamUsage)}
                            </pre>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div className="row">
                    <strong>Deployments</strong>
                    <div className="spacer" />
                    <span className="badge">
                      <span className="muted">agent</span>{" "}
                      <code>{selectedAgent?._id ?? "—"}</code>
                    </span>
                    <button
                      className="button"
                      onClick={() => void refreshDeployments()}
                      disabled={
                        !selectedAgent || deploymentsStatus === "loading"
                      }
                    >
                      {deploymentsStatus === "loading" ? "Loading…" : "Refresh"}
                    </button>
                  </div>
                </div>

                <div className="panel-body">
                  {!selectedAgent ? (
                    <div className="muted">
                      Select an agent to see deployments.
                    </div>
                  ) : deploymentsStatus === "error" ? (
                    <div className="muted" style={{ color: "var(--danger)" }}>
                      {deploymentsError}
                    </div>
                  ) : deployments.length === 0 ? (
                    <div className="muted">No deployments yet.</div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {deployments
                        .slice()
                        .sort((a, b) => b.version - a.version)
                        .map((d) => {
                          const isActivePointer =
                            selectedAgent.activeDeploymentId === d._id;
                          return (
                            <div
                              key={d._id}
                              style={{
                                border: "1px solid var(--border)",
                                borderRadius: 10,
                                background: "rgba(255,255,255,0.02)",
                                padding: 10,
                              }}
                            >
                              <div
                                className="row"
                                style={{ alignItems: "baseline" }}
                              >
                                <strong style={{ fontFamily: "var(--mono)" }}>
                                  v{d.version}
                                </strong>
                                <span className="badge">
                                  <span className="muted">status</span>{" "}
                                  {d.status}
                                </span>
                                <span className="badge">
                                  <span className="muted">runtime</span>{" "}
                                  {d.runtimeProvider}
                                </span>
                                {isActivePointer ? (
                                  <span className="badge">
                                    <span className="muted">active</span>{" "}
                                    pointer
                                  </span>
                                ) : null}
                                <div className="spacer" />
                                <button
                                  className="button"
                                  onClick={() => {
                                    setActivateDeploymentId(d._id);
                                    void activateDeployment(d._id);
                                  }}
                                  disabled={
                                    activateStatus === "loading" ||
                                    d.status !== "active"
                                  }
                                  title={
                                    d.status !== "active"
                                      ? "Only active deployments can be activated"
                                      : undefined
                                  }
                                >
                                  Activate
                                </button>
                              </div>

                              <div style={{ marginTop: 8 }} className="muted">
                                <div>
                                  <span className="muted">deploymentId:</span>{" "}
                                  <code>{d._id}</code>
                                </div>
                                <div>
                                  <span className="muted">created:</span>{" "}
                                  {formatMs(d.createdAtMs)}
                                </div>
                                <div>
                                  <span className="muted">deployed:</span>{" "}
                                  {formatMs(d.deployedAtMs)}
                                </div>
                                <div>
                                  <span className="muted">finished:</span>{" "}
                                  {formatMs(d.finishedAtMs)}
                                </div>
                                {d.errorMessage ? (
                                  <div style={{ color: "var(--danger)" }}>
                                    {d.errorMessage}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div className="row">
                    <strong>Rollback / activate deployment</strong>
                    <div className="spacer" />
                    <span className="badge">
                      <span className="muted">ADR-0005</span> pointer flip
                    </span>
                  </div>
                </div>

                <div className="panel-body">
                  {!selectedAgent ? (
                    <div className="muted">
                      Select an agent to activate a deployment.
                    </div>
                  ) : (
                    <>
                      <div
                        className="muted"
                        style={{ fontSize: 12, marginBottom: 10 }}
                      >
                        Enter a <code>deploymentId</code> to activate. This
                        updates <code>agents.activeDeploymentId</code>.
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 10,
                        }}
                      >
                        <input
                          className="button"
                          style={{ width: "100%", textAlign: "left" }}
                          value={activateDeploymentId}
                          onChange={(e) =>
                            setActivateDeploymentId(e.target.value)
                          }
                          placeholder="deployment id"
                          disabled={!canUseApi || activateStatus === "loading"}
                        />
                        <button
                          className="button"
                          onClick={() => void activateDeployment()}
                          disabled={
                            !canUseApi ||
                            activateStatus === "loading" ||
                            !activateDeploymentId.trim()
                          }
                        >
                          {activateStatus === "loading"
                            ? "Activating…"
                            : "Activate"}
                        </button>
                      </div>

                      {activateError ? (
                        <div style={{ marginTop: 10 }}>
                          <span
                            className="badge"
                            style={{
                              borderColor: "rgba(255, 107, 107, 0.6)",
                              background: "rgba(255, 107, 107, 0.08)",
                            }}
                          >
                            <span style={{ color: "var(--danger)" }}>
                              error
                            </span>{" "}
                            {activateError}
                          </span>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div className="row">
                    <strong>Telemetry</strong>
                    <div className="spacer" />
                    <span className="badge">
                      <span className="muted">live</span> refresh (5s)
                    </span>
                    <button
                      className="button"
                      onClick={() => void refreshUsageAndTelemetry()}
                      disabled={
                        usageStatus === "loading" || eventsStatus === "loading"
                      }
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="panel-body">
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 12,
                      alignItems: "start",
                    }}
                  >
                    <div>
                      <div className="row">
                        <strong>Current period usage</strong>
                        <div className="spacer" />
                        {usage ? (
                          <span className="badge">
                            <span className="muted">period</span>{" "}
                            {usage.periodKey}
                          </span>
                        ) : null}
                        {usage ? (
                          <span className="badge">
                            <span className="muted">tier</span> {usage.tier}
                          </span>
                        ) : null}
                      </div>

                      {usageStatus === "error" ? (
                        <div
                          className="muted"
                          style={{ color: "var(--danger)", marginTop: 8 }}
                        >
                          {usageError}
                        </div>
                      ) : null}

                      <pre
                        style={{
                          margin: 0,
                          marginTop: 8,
                          padding: 10,
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          background: "rgba(0,0,0,0.25)",
                          overflowX: "auto",
                          maxHeight: 240,
                        }}
                      >
                        {usage ? stringifyJson(usage) : "—"}
                      </pre>
                    </div>

                    <div>
                      <div className="row">
                        <strong>Recent events (last hour)</strong>
                        <div className="spacer" />
                        <span className="badge">
                          <span className="muted">agent</span>{" "}
                          <code>{selectedAgent?._id ?? "—"}</code>
                        </span>
                      </div>

                      {eventsStatus === "error" ? (
                        <div
                          className="muted"
                          style={{ color: "var(--danger)", marginTop: 8 }}
                        >
                          {eventsError}
                        </div>
                      ) : null}

                      <pre
                        style={{
                          margin: 0,
                          marginTop: 8,
                          padding: 10,
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          background: "rgba(0,0,0,0.25)",
                          overflowX: "auto",
                          maxHeight: 240,
                        }}
                      >
                        {events.length
                          ? stringifyJson(
                              events.slice(0, clamp(events.length, 1, 10)),
                            )
                          : "—"}
                      </pre>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Convert a raw (status, body) into an "ApiError-like" object that `summarizeError` can render.
 * This is used only for the optional, best-effort telemetry read calls until proper client methods exist.
 */
function toApiErrorLike(
  status: number,
  json: any,
  fallbackText: string,
): ControlPlaneApiError {
  if (
    json &&
    typeof json === "object" &&
    json.error &&
    typeof json.error.code === "string"
  ) {
    const e = json.error as any;
    return new ControlPlaneApiError({
      status,
      code: String(e.code),
      message: typeof e.message === "string" ? e.message : "Request failed",
      details:
        typeof e.details === "object" && e.details ? e.details : undefined,
      retryable: typeof e.retryable === "boolean" ? e.retryable : status >= 500,
      requestId: typeof e.requestId === "string" ? e.requestId : undefined,
    });
  }

  return new ControlPlaneApiError({
    status,
    code: status === 404 ? "NOT_FOUND" : "REQUEST_FAILED",
    message: fallbackText?.trim()
      ? fallbackText.trim().slice(0, 300)
      : `Request failed (${status})`,
    retryable: status >= 500,
  });
}
