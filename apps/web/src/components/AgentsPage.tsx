import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  type Agent,
  type BillingUsage,
  type Deployment,
  type InvokeV1Request,
  type InvokeV1Response,
  type MetricsEvent,
  type SseEvent,
  listAgents,
  createAgent as apiCreateAgent,
  deleteAgent as apiDeleteAgent,
  deployAgent as apiDeployAgent,
  activateDeployment as apiActivateDeployment,
  invoke as apiInvoke,
  invokeStream as apiInvokeStream,
  listDeployments,
  listRecentMetrics,
  getBillingUsage,
} from "../lib/supabaseApi";
import { useWorkspace } from "../lib/WorkspaceProvider";

/**
 * Agents UI
 *
 * Dedicated Agents page:
 * - Left sidebar: list/create agents
 * - Detail view: actions and data for the selected agent
 *
 * Uses `supabaseApi` for:
 * - Agents: list/create/delete (PostgREST + RPC)
 * - Deploy: deployAgent (Edge Function)
 * - Invoke: non-streaming + SSE streaming (Edge Function)
 * - Deployments: activateDeployment / rollback (Edge Function)
 * - Telemetry: billing usage + recent metrics (PostgREST)
 */

type RuntimeProvider = "cloudflare" | "agentcore" | "openrouter";

type AsyncStatus = "idle" | "loading" | "success" | "error";

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeError(err: unknown): string {
  if (err instanceof ApiError) {
    const status = ` status=${err.status}`;
    const retryable =
      typeof err.retryable === "boolean" ? ` retryable=${err.retryable}` : "";

    let details = "";
    if (err.details !== undefined) {
      try {
        details = ` details=${JSON.stringify(err.details)}`;
      } catch {
        details = " details=[unserializable]";
      }
    }

    return `${err.code}: ${err.message} (${status}${retryable})${details}`;
  }

  if (err instanceof Error) return err.message;
  return "Unknown error";
}

export type AgentsPageMode = "list" | "detail" | "combined";

export type AgentsPageProps = {
  mode?: AgentsPageMode;
  agentId?: string;
  onNavigateToAgent?: (agentId: string) => void;
  onBackToList?: () => void;
};

export default function AgentsPage(
  props: AgentsPageProps = {},
): React.ReactElement {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";

  /* -------------------------------------------------------------------------------------------------
   * Agents
   * ------------------------------------------------------------------------------------------------- */

  type AgentSortKey =
    | "name"
    | "status"
    | "runtime_provider"
    | "hasActiveDeployment"
    | "updated_at"
    | "created_at"
    | "id";
  type SortDir = "asc" | "desc";

  const [agentsStatus, setAgentsStatus] = useState<AsyncStatus>("idle");
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  const viewMode: AgentsPageMode = props.mode ?? "combined";
  const routeAgentId = props.agentId ?? "";

  useEffect(() => {
    if (routeAgentId) setSelectedAgentId(routeAgentId);
  }, [routeAgentId]);

  const handleSelectAgent = useCallback(
    (agentId: string) => {
      if (props.onNavigateToAgent) {
        props.onNavigateToAgent(agentId);
        return;
      }
      setSelectedAgentId(agentId);
    },
    [props],
  );

  const handleBackToList = useCallback(() => {
    if (props.onBackToList) {
      props.onBackToList();
      return;
    }
    setSelectedAgentId("");
  }, [props]);

  // Agents table controls
  const [agentSearch, setAgentSearch] = useState<string>("");
  const [agentStatusFilter, setAgentStatusFilter] = useState<
    "all" | Agent["status"]
  >("all");
  const [agentRuntimeFilter, setAgentRuntimeFilter] = useState<
    "all" | RuntimeProvider | "unknown"
  >("all");
  const [agentDeploymentFilter, setAgentDeploymentFilter] = useState<
    "all" | "has" | "none"
  >("all");

  const [agentSortKey, setAgentSortKey] = useState<AgentSortKey>("updated_at");
  const [agentSortDir, setAgentSortDir] = useState<SortDir>("desc");

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const defaultSortDirFor = useCallback((key: AgentSortKey): SortDir => {
    switch (key) {
      case "updated_at":
      case "created_at":
        return "desc";
      case "hasActiveDeployment":
        return "desc";
      case "name":
      case "status":
      case "runtime_provider":
      case "id":
      default:
        return "asc";
    }
  }, []);

  const toggleSort = useCallback((key: AgentSortKey) => {
    setAgentSortKey((prevKey) => {
      if (prevKey !== key) {
        setAgentSortDir(defaultSortDirFor(key));
        return key;
      }

      setAgentSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
      return prevKey;
    });
  }, [defaultSortDirFor]);

  const sortIndicator = useCallback(
    (key: AgentSortKey) => {
      if (agentSortKey !== key) return "";
      return agentSortDir === "asc" ? " ▲" : " ▼";
    },
    [agentSortDir, agentSortKey],
  );

  const visibleAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();

    const matches = (a: Agent) => {
      if (agentStatusFilter !== "all" && a.status !== agentStatusFilter)
        return false;

      const runtime = (a.runtime_provider ?? "unknown") as
        | RuntimeProvider
        | "unknown";

      if (agentRuntimeFilter !== "all" && runtime !== agentRuntimeFilter)
        return false;

      const hasDep = !!a.active_deployment_id;
      if (agentDeploymentFilter === "has" && !hasDep) return false;
      if (agentDeploymentFilter === "none" && hasDep) return false;

      if (!q) return true;

      const hay = [
        a.name,
        a.description ?? "",
        a.id,
        a.status,
        runtime,
        hasDep ? "hasDeployment" : "noDeployment",
        a.active_deployment_id ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    };

    const getSortValue = (a: Agent, key: AgentSortKey): string | number => {
      const runtime = (a.runtime_provider ?? "unknown") as
        | RuntimeProvider
        | "unknown";

      if (key === "name") return a.name ?? "";
      if (key === "status") return a.status ?? "";
      if (key === "runtime_provider") return runtime;
      if (key === "hasActiveDeployment") return a.active_deployment_id ? 1 : 0;
      if (key === "created_at") return a.created_at ?? "";
      if (key === "updated_at") return a.updated_at ?? "";
      if (key === "id") return a.id ?? "";
      return 0;
    };

    const dir = agentSortDir === "asc" ? 1 : -1;

    return agents
      .slice()
      .filter(matches)
      .sort((a, b) => {
        const av = getSortValue(a, agentSortKey);
        const bv = getSortValue(b, agentSortKey);

        if (typeof av === "number" && typeof bv === "number") {
          if (av === bv) return 0;
          return av < bv ? -1 * dir : 1 * dir;
        }

        const as = String(av);
        const bs = String(bv);
        const cmp = as.localeCompare(bs);
        return cmp * dir;
      });
  }, [
    agents,
    agentSearch,
    agentSortDir,
    agentSortKey,
    agentStatusFilter,
    agentRuntimeFilter,
    agentDeploymentFilter,
  ]);

  const refreshAgents = useCallback(async () => {
    if (!workspaceId) return;

    setAgentsStatus("loading");
    setAgentsError(null);

    try {
      const list = await listAgents(workspaceId, {
        limit: 200,
        includeDeleted: false,
      });
      setAgents(list);

      if (list.length > 0) {
        const stillExists =
          selectedAgentId && list.some((a) => a.id === selectedAgentId);

        if (!stillExists) {
          if (routeAgentId && list.some((a) => a.id === routeAgentId)) {
            setSelectedAgentId(routeAgentId);
          } else if (viewMode === "combined") {
            const newest = [...list].sort(
              (a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""),
            )[0];
            setSelectedAgentId(newest.id);
          } else {
            setSelectedAgentId("");
          }
        }
      } else {
        setSelectedAgentId("");
      }

      setAgentsStatus("success");
    } catch (err) {
      setAgentsStatus("error");
      setAgentsError(summarizeError(err));
    }
  }, [workspaceId, routeAgentId, selectedAgentId]);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  const [createName, setCreateName] = useState("demo-agent");
  const [createDescription, setCreateDescription] = useState("");
  const [createSystemPrompt, setCreateSystemPrompt] = useState("");
  const [createModel, setCreateModel] = useState("anthropic/claude-sonnet-4-20250514");

  const [createStatus, setCreateStatus] = useState<AsyncStatus>("idle");
  const [createError, setCreateError] = useState<string | null>(null);

  const createAgent = useCallback(async () => {
    if (!workspaceId) return;

    const name = createName.trim();
    if (!name) {
      setCreateError("Name is required");
      setCreateStatus("error");
      return;
    }

    setCreateStatus("loading");
    setCreateError(null);

    try {
      const agent = await apiCreateAgent({
        workspace_id: workspaceId,
        name,
        description: createDescription.trim() || undefined,
        env_var_keys: [],
        runtime_provider: "openrouter",
        system_prompt: createSystemPrompt.trim() || undefined,
        model: createModel.trim() || undefined,
      });

      // Optimistic insert
      setAgents((prev) => [agent, ...prev]);

      if (viewMode === "list" && props.onNavigateToAgent) {
        props.onNavigateToAgent(agent.id);
      } else {
        setSelectedAgentId(agent.id);
      }

      setCreateStatus("success");
    } catch (err) {
      setCreateStatus("error");
      setCreateError(summarizeError(err));
    }
  }, [workspaceId, createDescription, createName, createSystemPrompt, createModel]);

  /* -------------------------------------------------------------------------------------------------
   * Delete agent
   * ------------------------------------------------------------------------------------------------- */

  const [deleteStatus, setDeleteStatus] = useState<AsyncStatus>("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteSelectedAgent = useCallback(async () => {
    if (!selectedAgent) return;

    const ok = window.confirm(
      `Delete agent "${selectedAgent.name}"?\n\nThis will remove the agent and all of its deployments.`,
    );
    if (!ok) return;

    setDeleteStatus("loading");
    setDeleteError(null);

    try {
      await apiDeleteAgent(selectedAgent.id);

      setAgents((prev) => prev.filter((a) => a.id !== selectedAgent.id));
      if (selectedAgentId === selectedAgent.id) {
        setSelectedAgentId("");
      }

      setDeleteStatus("success");
      await refreshAgents();
    } catch (err) {
      setDeleteStatus("error");
      setDeleteError(summarizeError(err));
    }
  }, [refreshAgents, selectedAgent, selectedAgentId]);

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
    if (!selectedAgent) return;

    setDeployStatus("loading");
    setDeployError(null);
    setDeployResult(null);

    try {
      const deployment = await apiDeployAgent(selectedAgent.id, {
        invokePath: deployInvokePath.trim() || undefined,
        compatibilityDate: deployCompatibilityDate.trim() || undefined,
      });

      setDeployResult(deployment);
      setDeployStatus("success");

      await refreshAgents();
      setTimeout(() => void refreshAgents(), 1500);
      setTimeout(() => void refreshAgents(), 3500);
    } catch (err) {
      setDeployStatus("error");
      setDeployError(summarizeError(err));
    }
  }, [
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
      if (!selectedAgent) return;

      const deploymentId = (
        deploymentIdOverride ?? activateDeploymentId
      ).trim();
      if (!deploymentId) return;

      setActivateStatus("loading");
      setActivateError(null);

      try {
        await apiActivateDeployment(selectedAgent.id, deploymentId, {
          reason: "dashboard activation",
        });

        setActivateStatus("success");
        await refreshAgents();
      } catch (err) {
        setActivateStatus("error");
        setActivateError(summarizeError(err));
      }
    },
    [activateDeploymentId, refreshAgents, selectedAgent],
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

      const resp = await apiInvoke(selectedAgent.id, req);

      setInvokeResponse(resp);
      setInvokeRaw(stringifyJson(resp));
      setInvokeStatus("success");

      if (resp.sessionId) setInvokeSessionId(resp.sessionId);
    } catch (err) {
      setInvokeStatus("error");
      setInvokeError(summarizeError(err));
    }
  }, [invokePrompt, invokeSessionId, selectedAgent]);

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setStreamStatus("idle");
  }, []);

  const invokeSelectedStream = useCallback(async () => {
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

      for await (const evt of apiInvokeStream(selectedAgent.id, req, {
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
  }, [invokePrompt, invokeSessionId, selectedAgent]);

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
    if (!selectedAgent) {
      setDeployments([]);
      setDeploymentsStatus("idle");
      setDeploymentsError(null);
      return;
    }

    setDeploymentsStatus("loading");
    setDeploymentsError(null);

    try {
      const list = await listDeployments(selectedAgent.id, {
        limit: 50,
      });
      setDeployments(list);
      setDeploymentsStatus("success");
    } catch (err) {
      setDeploymentsStatus("error");
      setDeploymentsError(summarizeError(err));
    }
  }, [selectedAgent]);

  /* -------------------------------------------------------------------------------------------------
   * Telemetry (live; read endpoints)
   * ------------------------------------------------------------------------------------------------- */

  const [usageStatus, setUsageStatus] = useState<AsyncStatus>("idle");
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);

  const [eventsStatus, setEventsStatus] = useState<AsyncStatus>("idle");
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [events, setEvents] = useState<MetricsEvent[]>([]);

  const refreshUsageAndTelemetry = useCallback(async () => {
    if (!workspaceId) return;

    setUsageStatus("loading");
    setUsageError(null);

    setEventsStatus("loading");
    setEventsError(null);

    try {
      const usageResult = await getBillingUsage(workspaceId);
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

      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recent = await listRecentMetrics(selectedAgent.id, {
        since,
        limit: 50,
      });

      setEvents(recent);
      setEventsStatus("success");
    } catch (err) {
      setEventsStatus("error");
      setEventsError(summarizeError(err));
    }
  }, [workspaceId, selectedAgent]);

  // Refresh deployments and telemetry when selection changes.
  useEffect(() => {
    if (viewMode === "list") return;

    setDeleteStatus("idle");
    setDeleteError(null);

    void refreshDeployments();
    void refreshUsageAndTelemetry();
  }, [selectedAgentId, refreshDeployments, refreshUsageAndTelemetry, viewMode]);

  // Live telemetry polling (best-effort).
  useEffect(() => {
    if (!workspaceId) return;
    if (viewMode === "list") return;
    if (!selectedAgent) return;

    const id = setInterval(() => {
      void refreshUsageAndTelemetry();
    }, 5000);
    return () => clearInterval(id);
  }, [workspaceId, refreshUsageAndTelemetry, selectedAgent, viewMode]);

  /* -------------------------------------------------------------------------------------------------
   * Render
   * ------------------------------------------------------------------------------------------------- */

  const canUseApi = !!workspaceId;

  return (
    <>
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-header">
          <div className="row">
            <div className="brand">
              <div className="brand-title">Agents</div>
              <div className="brand-subtitle">
                Manage agents — select, deploy, invoke, and inspect telemetry
              </div>
            </div>
            <div className="spacer" />
            <span className="badge">
              <span className="muted">workspace</span>{" "}
              <code>{workspace?.name ?? "(loading)"}</code>
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
      </div>

      <div>
          {!canUseApi ? (
            <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
              <div className="muted">
                Waiting for workspace to load. If this persists, check that{" "}
                <code>VITE_SUPABASE_URL</code> and{" "}
                <code>VITE_SUPABASE_ANON_KEY</code> are set in{" "}
                <code>.env</code>.
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
            className={viewMode === "combined" ? "acp-agents-layout" : undefined}
          >
            {/* Left column: Agents sidebar */}
            <aside
              className={viewMode === "list" ? "panel" : "panel acp-agents-subsidebar"}
              id="agents"
              aria-label="Agents sidebar"
              style={{ display: viewMode === "detail" ? "none" : undefined }}
            >
              <div className="panel-header">
                <div className="row">
                  <strong>Agents</strong>
                  <div className="spacer" />
                  <span className="muted">{agents.length} total</span>
                </div>
              </div>

              <div className="panel-body">
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 10 }}
                >
                  <div
                    className="acp-agents-subsidebar-scroll"
                    aria-label="Agent list"
                  >
                    {agents.length === 0 ? (
                      <div className="muted" style={{ fontSize: 13 }}>
                        No agents yet. Create one below.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <input
                            className="button"
                            style={{ width: "100%", textAlign: "left" }}
                            value={agentSearch}
                            onChange={(e) => setAgentSearch(e.target.value)}
                            placeholder="Search (name, id, status, runtime, deployment)…"
                            disabled={!canUseApi}
                          />

                          <select
                            className="button"
                            style={{ width: "100%", textAlign: "left" }}
                            value={agentStatusFilter}
                            onChange={(e) =>
                              setAgentStatusFilter(
                                e.target.value as "all" | Agent["status"],
                              )
                            }
                            disabled={!canUseApi}
                            aria-label="Filter by status"
                          >
                            <option value="all">All statuses</option>
                            <option value="created">created</option>
                            <option value="deploying">deploying</option>
                            <option value="active">active</option>
                            <option value="error">error</option>
                            <option value="disabled">disabled</option>
                          </select>

                          <select
                            className="button"
                            style={{ width: "100%", textAlign: "left" }}
                            value={agentRuntimeFilter}
                            onChange={(e) =>
                              setAgentRuntimeFilter(
                                e.target.value as "all" | RuntimeProvider | "unknown",
                              )
                            }
                            disabled={!canUseApi}
                            aria-label="Filter by runtime"
                          >
                            <option value="all">All runtimes</option>
                            <option value="openrouter">openrouter</option>
                            <option value="cloudflare">cloudflare</option>
                            <option value="agentcore">agentcore</option>
                            <option value="unknown">unknown</option>
                          </select>

                          <select
                            className="button"
                            style={{ width: "100%", textAlign: "left" }}
                            value={agentDeploymentFilter}
                            onChange={(e) =>
                              setAgentDeploymentFilter(
                                e.target.value as "all" | "has" | "none",
                              )
                            }
                            disabled={!canUseApi}
                            aria-label="Filter by active deployment"
                          >
                            <option value="all">Any deployment state</option>
                            <option value="has">Has active deployment</option>
                            <option value="none">No active deployment</option>
                          </select>

                          <div className="row" style={{ gap: 8 }}>
                            <button
                              type="button"
                              className="button"
                              onClick={() => {
                                setAgentSearch("");
                                setAgentStatusFilter("all");
                                setAgentRuntimeFilter("all");
                                setAgentDeploymentFilter("all");
                                setAgentSortKey("updated_at");
                                setAgentSortDir("desc");
                              }}
                              disabled={!canUseApi}
                              title="Reset search, filters, and sorting"
                            >
                              Reset
                            </button>

                            <span className="badge">
                              <span className="muted">shown</span>{" "}
                              {visibleAgents.length}
                            </span>
                          </div>
                        </div>

                        <div style={{ overflowX: "auto" }}>
                          <table
                            style={{
                              width: "100%",
                              borderCollapse: "collapse",
                              fontSize: 13,
                            }}
                            aria-label="Agents table"
                          >
                            <thead>
                              <tr>
                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px 6px",
                                    borderBottom: "1px solid var(--border)",
                                    position: "sticky",
                                    top: 0,
                                    background: "var(--panel)",
                                    cursor: "pointer",
                                  }}
                                  onClick={() => toggleSort("name")}
                                  aria-sort={
                                    agentSortKey === "name"
                                      ? agentSortDir === "asc"
                                        ? "ascending"
                                        : "descending"
                                      : "none"
                                  }
                                  title="Sort by name"
                                >
                                  Name{sortIndicator("name")}
                                </th>

                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px 6px",
                                    borderBottom: "1px solid var(--border)",
                                    position: "sticky",
                                    top: 0,
                                    background: "var(--panel)",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                  onClick={() => toggleSort("status")}
                                  aria-sort={
                                    agentSortKey === "status"
                                      ? agentSortDir === "asc"
                                        ? "ascending"
                                        : "descending"
                                      : "none"
                                  }
                                  title="Sort by status"
                                >
                                  Status{sortIndicator("status")}
                                </th>

                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px 6px",
                                    borderBottom: "1px solid var(--border)",
                                    position: "sticky",
                                    top: 0,
                                    background: "var(--panel)",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                  onClick={() => toggleSort("runtime_provider")}
                                  aria-sort={
                                    agentSortKey === "runtime_provider"
                                      ? agentSortDir === "asc"
                                        ? "ascending"
                                        : "descending"
                                      : "none"
                                  }
                                  title="Sort by runtime"
                                >
                                  Runtime{sortIndicator("runtime_provider")}
                                </th>

                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px 6px",
                                    borderBottom: "1px solid var(--border)",
                                    position: "sticky",
                                    top: 0,
                                    background: "var(--panel)",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                  onClick={() => toggleSort("hasActiveDeployment")}
                                  aria-sort={
                                    agentSortKey === "hasActiveDeployment"
                                      ? agentSortDir === "asc"
                                        ? "ascending"
                                        : "descending"
                                      : "none"
                                  }
                                  title="Sort by active deployment presence"
                                >
                                  Deployment{sortIndicator("hasActiveDeployment")}
                                </th>

                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px 6px",
                                    borderBottom: "1px solid var(--border)",
                                    position: "sticky",
                                    top: 0,
                                    background: "var(--panel)",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                  onClick={() => toggleSort("updated_at")}
                                  aria-sort={
                                    agentSortKey === "updated_at"
                                      ? agentSortDir === "asc"
                                        ? "ascending"
                                        : "descending"
                                      : "none"
                                  }
                                  title="Sort by last updated"
                                >
                                  Updated{sortIndicator("updated_at")}
                                </th>

                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px 6px",
                                    borderBottom: "1px solid var(--border)",
                                    position: "sticky",
                                    top: 0,
                                    background: "var(--panel)",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                  onClick={() => toggleSort("created_at")}
                                  aria-sort={
                                    agentSortKey === "created_at"
                                      ? agentSortDir === "asc"
                                        ? "ascending"
                                        : "descending"
                                      : "none"
                                  }
                                  title="Sort by created time"
                                >
                                  Created{sortIndicator("created_at")}
                                </th>

                                <th
                                  style={{
                                    textAlign: "left",
                                    padding: "8px 6px",
                                    borderBottom: "1px solid var(--border)",
                                    position: "sticky",
                                    top: 0,
                                    background: "var(--panel)",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                  onClick={() => toggleSort("id")}
                                  aria-sort={
                                    agentSortKey === "id"
                                      ? agentSortDir === "asc"
                                        ? "ascending"
                                        : "descending"
                                      : "none"
                                  }
                                  title="Sort by agent id"
                                >
                                  ID{sortIndicator("id")}
                                </th>
                              </tr>
                            </thead>

                            <tbody>
                              {visibleAgents.map((a) => {
                                const active = a.id === selectedAgentId;
                                const rowBg = active
                                  ? "rgba(110, 168, 254, 0.10)"
                                  : "transparent";

                                const runtime = a.runtime_provider ?? "unknown";

                                return (
                                  <tr
                                    key={a.id}
                                    style={{
                                      background: rowBg,
                                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                                    }}
                                  >
                                    <td style={{ padding: "8px 6px", verticalAlign: "top" }}>
                                      <button
                                        type="button"
                                        className={active ? "button button-primary" : "button"}
                                        onClick={() => handleSelectAgent(a.id)}
                                        disabled={!canUseApi}
                                        title={a.id}
                                        style={{
                                          width: "100%",
                                          textAlign: "left",
                                          padding: "8px 10px",
                                        }}
                                      >
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                          <span style={{ fontWeight: 800 }}>{a.name}</span>
                                          {a.active_deployment_id ? (
                                            <span className="badge" style={{ flex: "0 0 auto" }}>
                                              <span className="muted">active</span> dep
                                            </span>
                                          ) : (
                                            <span className="badge" style={{ flex: "0 0 auto" }}>
                                              <span className="muted">no</span> dep
                                            </span>
                                          )}
                                        </div>

                                        <div
                                          className="muted"
                                          style={{ marginTop: 6, fontSize: 12, lineHeight: 1.35 }}
                                        >
                                          {a.description ? a.description : "—"}
                                        </div>
                                      </button>
                                    </td>

                                    <td style={{ padding: "8px 6px", verticalAlign: "top" }}>
                                      <span className="badge">
                                        <span className="muted">status</span> {a.status}
                                      </span>
                                    </td>

                                    <td style={{ padding: "8px 6px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                                      <span className="badge">
                                        <span className="muted">rt</span> {runtime}
                                      </span>
                                    </td>

                                    <td style={{ padding: "8px 6px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                                      {a.active_deployment_id ? (
                                        <span className="badge">
                                          <span className="muted">dep</span>{" "}
                                          <code>{a.active_deployment_id}</code>
                                        </span>
                                      ) : (
                                        <span className="badge">
                                          <span className="muted">dep</span> —
                                        </span>
                                      )}
                                    </td>

                                    <td style={{ padding: "8px 6px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                                      {formatDate(a.updated_at)}
                                    </td>

                                    <td style={{ padding: "8px 6px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                                      {formatDate(a.created_at)}
                                    </td>

                                    <td style={{ padding: "8px 6px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                                      <code>{a.id}</code>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {visibleAgents.length === 0 ? (
                          <div className="muted" style={{ fontSize: 13 }}>
                            No agents match your filters.
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <hr />

                  <div>
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

                  <label className="muted" style={{ fontSize: 12 }}>
                    Model
                  </label>
                  <select
                    className="button"
                    style={{ width: "100%", textAlign: "left" }}
                    value={createModel}
                    onChange={(e) => setCreateModel(e.target.value)}
                    disabled={!canUseApi || createStatus === "loading"}
                  >
                    <optgroup label="Anthropic">
                      <option value="anthropic/claude-sonnet-4-20250514">Claude Sonnet 4</option>
                      <option value="anthropic/claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                      <option value="anthropic/claude-opus-4-20250514">Claude Opus 4</option>
                    </optgroup>
                    <optgroup label="OpenAI">
                      <option value="openai/gpt-4o">GPT-4o</option>
                      <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
                      <option value="openai/o3-mini">o3-mini</option>
                    </optgroup>
                    <optgroup label="Google">
                      <option value="google/gemini-2.5-pro-preview">Gemini 2.5 Pro</option>
                      <option value="google/gemini-2.5-flash-preview">Gemini 2.5 Flash</option>
                    </optgroup>
                    <optgroup label="Meta">
                      <option value="meta-llama/llama-4-maverick">Llama 4 Maverick</option>
                      <option value="meta-llama/llama-4-scout">Llama 4 Scout</option>
                    </optgroup>
                  </select>

                  <label className="muted" style={{ fontSize: 12 }}>
                    System prompt (optional)
                  </label>
                  <textarea
                    className="button"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      minHeight: 80,
                      resize: "vertical",
                      fontFamily: "inherit",
                    }}
                    value={createSystemPrompt}
                    onChange={(e) => setCreateSystemPrompt(e.target.value)}
                    placeholder="You are a helpful assistant..."
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
            </aside>

            {/* Right column: Selected agent actions */}
            <div
              className="acp-agents-detail"
              style={{
                display: viewMode === "list" ? "none" : "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <section className="panel" id="agent">
                <div className="panel-header">
                  <div className="row">
                    <button
                      className="button"
                      type="button"
                      onClick={() => handleBackToList()}
                      style={{
                        display: viewMode === "detail" ? "inline-flex" : "none",
                      }}
                      title="Back to agents list"
                    >
                      &larr; Back
                    </button>

                    <strong>Selected agent</strong>

                    <div className="spacer" />

                    {selectedAgent ? (
                      <div className="row" style={{ gap: 8 }}>
                        <button
                          className="button"
                          type="button"
                          onClick={() => {
                            const text = selectedAgent.id;

                            if (navigator.clipboard?.writeText) {
                              void navigator.clipboard.writeText(text);
                              return;
                            }

                            const el = document.createElement("textarea");
                            el.value = text;
                            el.style.position = "fixed";
                            el.style.left = "-9999px";
                            el.style.top = "0";
                            document.body.appendChild(el);
                            el.focus();
                            el.select();
                            try {
                              document.execCommand("copy");
                            } finally {
                              document.body.removeChild(el);
                            }
                          }}
                          title="Copy agent id"
                        >
                          Copy ID
                        </button>

                        <button
                          className="button"
                          type="button"
                          onClick={() => {
                            void refreshAgents();
                            void refreshDeployments();
                            void refreshUsageAndTelemetry();
                          }}
                          title="Refresh agent details (deployments + usage + telemetry)"
                        >
                          Refresh details
                        </button>

                        <a className="button" href="#deployments" title="Jump to deployments">
                          Deployments &darr;
                        </a>
                      </div>
                    ) : null}

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
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
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
                            <code>{selectedAgent.id}</code>
                          </div>

                          <div style={{ height: 8 }} />

                          <div className="muted" style={{ fontSize: 12 }}>
                            Active deployment
                          </div>
                          <div>
                            <code>
                              {selectedAgent.active_deployment_id ?? "(none)"}
                            </code>
                          </div>
                        </div>

                        <div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Created
                          </div>
                          <div>{formatDate(selectedAgent.created_at)}</div>

                          <div style={{ height: 8 }} />

                          <div className="muted" style={{ fontSize: 12 }}>
                            Updated
                          </div>
                          <div>{formatDate(selectedAgent.updated_at)}</div>
                        </div>
                      </div>

                      <div className="row">
                        <button
                          className="button button-danger"
                          onClick={() => void deleteSelectedAgent()}
                          disabled={!canUseApi || deleteStatus === "loading"}
                          title="Delete agent and remove all deployments"
                        >
                          {deleteStatus === "loading"
                            ? "Deleting…"
                            : "Delete agent"}
                        </button>

                        {deleteError ? (
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
                            {deleteError}
                          </span>
                        ) : null}

                        {deleteStatus === "success" ? (
                          <span className="badge">
                            <span className="muted">deleted</span>
                          </span>
                        ) : null}
                      </div>

                      <div className="muted" style={{ fontSize: 12 }}>
                        Deleting an agent also removes all deployments.
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section className="panel" id="deploy">
                <div className="panel-header">
                  <div className="row">
                    <strong>Deploy (Cloudflare)</strong>
                    <div className="spacer" />
                    <span className="badge">
                      <span className="muted">runtime</span> template worker
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

              <section className="panel" id="invoke">
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

              <section className="panel" id="deployments">
                <div className="panel-header">
                  <div className="row">
                    <strong>Deployments</strong>
                    <div className="spacer" />
                    <span className="badge">
                      <span className="muted">agent</span>{" "}
                      <code>{selectedAgent?.id ?? "—"}</code>
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
                            selectedAgent.active_deployment_id === d.id;
                          return (
                            <div
                              key={d.id}
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
                                  {d.runtime_provider}
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
                                    setActivateDeploymentId(d.id);
                                    void activateDeployment(d.id);
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
                                  <code>{d.id}</code>
                                </div>
                                <div>
                                  <span className="muted">created:</span>{" "}
                                  {formatDate(d.created_at)}
                                </div>
                                <div>
                                  <span className="muted">deployed:</span>{" "}
                                  {formatDate(d.deployed_at)}
                                </div>
                                <div>
                                  <span className="muted">finished:</span>{" "}
                                  {formatDate(d.finished_at)}
                                </div>
                                {d.error_message ? (
                                  <div style={{ color: "var(--danger)" }}>
                                    {d.error_message}
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

              <section className="panel" id="rollback">
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
                        updates <code>agents.active_deployment_id</code>.
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

              <section className="panel" id="telemetry">
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
                            {usage.period_key}
                          </span>
                        ) : null}
                        {usage ? (
                          <span className="badge">
                            <span className="muted">paid</span>{" "}
                            {usage.paid ? "yes" : "no"}
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
                          <code>{selectedAgent?.id ?? "—"}</code>
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
    </>
  );
}
