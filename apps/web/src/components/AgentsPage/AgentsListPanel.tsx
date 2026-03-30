import React, { useCallback, useMemo, useState } from "react";
import type { Agent, AgentSortKey, AsyncStatus, RuntimeProvider, SortDir } from "./types";
import { formatDate } from "./utils";

export type AgentsListPanelProps = {
  agents: Agent[];
  selectedAgentId: string;
  canUseApi: boolean;
  viewMode: "list" | "detail" | "combined";
  onSelectAgent: (agentId: string) => void;
  onCreate: (opts: {
    name: string;
    description: string;
    systemPrompt: string;
    model: string;
  }) => Promise<void>;
  createStatus: AsyncStatus;
  createError: string | null;
};

export default function AgentsListPanel({
  agents,
  selectedAgentId,
  canUseApi,
  viewMode,
  onSelectAgent,
  onCreate,
  createStatus,
  createError,
}: AgentsListPanelProps): React.ReactElement {
  const [agentSearch, setAgentSearch] = useState("");
  const [agentStatusFilter, setAgentStatusFilter] = useState<"all" | Agent["status"]>("all");
  const [agentRuntimeFilter, setAgentRuntimeFilter] = useState<"all" | RuntimeProvider | "unknown">("all");
  const [agentDeploymentFilter, setAgentDeploymentFilter] = useState<"all" | "has" | "none">("all");
  const [agentSortKey, setAgentSortKey] = useState<AgentSortKey>("updated_at");
  const [agentSortDir, setAgentSortDir] = useState<SortDir>("desc");

  const [createName, setCreateName] = useState("demo-agent");
  const [createDescription, setCreateDescription] = useState("");
  const [createSystemPrompt, setCreateSystemPrompt] = useState("");
  const [createModel, setCreateModel] = useState("anthropic/claude-sonnet-4-20250514");

  const defaultSortDirFor = useCallback((key: AgentSortKey): SortDir => {
    switch (key) {
      case "updated_at":
      case "created_at":
      case "hasActiveDeployment":
        return "desc";
      default:
        return "asc";
    }
  }, []);

  const toggleSort = useCallback(
    (key: AgentSortKey) => {
      setAgentSortKey((prevKey) => {
        if (prevKey !== key) {
          setAgentSortDir(defaultSortDirFor(key));
          return key;
        }
        setAgentSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      });
    },
    [defaultSortDirFor],
  );

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
      if (agentStatusFilter !== "all" && a.status !== agentStatusFilter) return false;
      const runtime = (a.runtime_provider ?? "unknown") as RuntimeProvider | "unknown";
      if (agentRuntimeFilter !== "all" && runtime !== agentRuntimeFilter) return false;
      const hasDep = !!a.active_deployment_id;
      if (agentDeploymentFilter === "has" && !hasDep) return false;
      if (agentDeploymentFilter === "none" && hasDep) return false;
      if (!q) return true;
      const hay = [a.name, a.description ?? "", a.id, a.status, runtime, hasDep ? "hasDeployment" : "noDeployment", a.active_deployment_id ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    };

    const getSortValue = (a: Agent, key: AgentSortKey): string | number => {
      const runtime = (a.runtime_provider ?? "unknown") as RuntimeProvider | "unknown";
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
        return as.localeCompare(bs) * dir;
      });
  }, [agents, agentSearch, agentSortDir, agentSortKey, agentStatusFilter, agentRuntimeFilter, agentDeploymentFilter]);

  const handleCreate = () => {
    void onCreate({
      name: createName,
      description: createDescription,
      systemPrompt: createSystemPrompt,
      model: createModel,
    });
  };

  const thStyle = (key: AgentSortKey): React.CSSProperties => ({
    textAlign: "left",
    padding: "8px 6px",
    borderBottom: "1px solid var(--border)",
    position: "sticky",
    top: 0,
    background: "var(--panel)",
    cursor: "pointer",
    whiteSpace: key === "name" ? undefined : "nowrap",
  });

  const ariaSortFor = (key: AgentSortKey): "ascending" | "descending" | "none" => {
    if (agentSortKey !== key) return "none";
    return agentSortDir === "asc" ? "ascending" : "descending";
  };

  return (
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
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="acp-agents-subsidebar-scroll" aria-label="Agent list">
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
                    onChange={(e) => setAgentStatusFilter(e.target.value as "all" | Agent["status"])}
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
                    onChange={(e) => setAgentRuntimeFilter(e.target.value as "all" | RuntimeProvider | "unknown")}
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
                    onChange={(e) => setAgentDeploymentFilter(e.target.value as "all" | "has" | "none")}
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
                      <span className="muted">shown</span> {visibleAgents.length}
                    </span>
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
                    aria-label="Agents table"
                  >
                    <thead>
                      <tr>
                        <th style={thStyle("name")} onClick={() => toggleSort("name")} aria-sort={ariaSortFor("name")} title="Sort by name">
                          Name{sortIndicator("name")}
                        </th>
                        <th style={thStyle("status")} onClick={() => toggleSort("status")} aria-sort={ariaSortFor("status")} title="Sort by status">
                          Status{sortIndicator("status")}
                        </th>
                        <th style={thStyle("runtime_provider")} onClick={() => toggleSort("runtime_provider")} aria-sort={ariaSortFor("runtime_provider")} title="Sort by runtime">
                          Runtime{sortIndicator("runtime_provider")}
                        </th>
                        <th style={thStyle("hasActiveDeployment")} onClick={() => toggleSort("hasActiveDeployment")} aria-sort={ariaSortFor("hasActiveDeployment")} title="Sort by active deployment presence">
                          Deployment{sortIndicator("hasActiveDeployment")}
                        </th>
                        <th style={thStyle("updated_at")} onClick={() => toggleSort("updated_at")} aria-sort={ariaSortFor("updated_at")} title="Sort by last updated">
                          Updated{sortIndicator("updated_at")}
                        </th>
                        <th style={thStyle("created_at")} onClick={() => toggleSort("created_at")} aria-sort={ariaSortFor("created_at")} title="Sort by created time">
                          Created{sortIndicator("created_at")}
                        </th>
                        <th style={thStyle("id")} onClick={() => toggleSort("id")} aria-sort={ariaSortFor("id")} title="Sort by agent id">
                          ID{sortIndicator("id")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAgents.map((a) => {
                        const active = a.id === selectedAgentId;
                        const rowBg = active ? "rgba(110, 168, 254, 0.10)" : "transparent";
                        const runtime = a.runtime_provider ?? "unknown";

                        return (
                          <tr key={a.id} style={{ background: rowBg, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                            <td style={{ padding: "8px 6px", verticalAlign: "top" }}>
                              <button
                                type="button"
                                className={active ? "button button-primary" : "button"}
                                onClick={() => onSelectAgent(a.id)}
                                disabled={!canUseApi}
                                title={a.id}
                                style={{ width: "100%", textAlign: "left", padding: "8px 10px" }}
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
                                <div className="muted" style={{ marginTop: 6, fontSize: 12, lineHeight: 1.35 }}>
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
                                  <span className="muted">dep</span> <code>{a.active_deployment_id}</code>
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

          <label className="muted" style={{ fontSize: 12 }}>Name</label>
          <input
            className="button"
            style={{ width: "100%", textAlign: "left" }}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="demo-agent"
            disabled={!canUseApi || createStatus === "loading"}
          />

          <label className="muted" style={{ fontSize: 12 }}>Description (optional)</label>
          <input
            className="button"
            style={{ width: "100%", textAlign: "left" }}
            value={createDescription}
            onChange={(e) => setCreateDescription(e.target.value)}
            placeholder="A minimal agent"
            disabled={!canUseApi || createStatus === "loading"}
          />

          <label className="muted" style={{ fontSize: 12 }}>Model</label>
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

          <label className="muted" style={{ fontSize: 12 }}>System prompt (optional)</label>
          <textarea
            className="button"
            style={{ width: "100%", textAlign: "left", minHeight: 80, resize: "vertical", fontFamily: "inherit" }}
            value={createSystemPrompt}
            onChange={(e) => setCreateSystemPrompt(e.target.value)}
            placeholder="You are a helpful assistant..."
            disabled={!canUseApi || createStatus === "loading"}
          />

          <button
            className="button button-primary"
            onClick={handleCreate}
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
  );
}
