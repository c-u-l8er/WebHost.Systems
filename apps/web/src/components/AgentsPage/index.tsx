import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Agent,
  type BillingUsage,
  type Deployment,
  type MetricsEvent,
  listAgents,
  createAgent as apiCreateAgent,
  deleteAgent as apiDeleteAgent,
  deployAgent as apiDeployAgent,
  activateDeployment as apiActivateDeployment,
  listDeployments,
  listRecentMetrics,
  getBillingUsage,
} from "../../lib/supabaseApi";
import { useWorkspace } from "../../lib/WorkspaceProvider";
import type { AgentsPageMode, AgentsPageProps, AsyncStatus } from "./types";
import { summarizeError } from "./utils";
import AgentsListPanel from "./AgentsListPanel";
import AgentDetailPanel from "./AgentDetailPanel";
import DeployPanel from "./DeployPanel";
import InvokePanel from "./InvokePanel";
import DeploymentsPanel from "./DeploymentsPanel";
import RollbackPanel from "./RollbackPanel";
import TelemetryPanel from "./TelemetryPanel";

export type { AgentsPageMode, AgentsPageProps };

export default function AgentsPage(
  props: AgentsPageProps = {},
): React.ReactElement {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? "";

  // --- Agents state ---
  const [agentsStatus, setAgentsStatus] = useState<AsyncStatus>("idle");
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");

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

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const refreshAgents = useCallback(async () => {
    if (!workspaceId) return;

    setAgentsStatus("loading");
    setAgentsError(null);

    try {
      const list = await listAgents(workspaceId, { limit: 200, includeDeleted: false });
      setAgents(list);

      if (list.length > 0) {
        const stillExists = selectedAgentId && list.some((a) => a.id === selectedAgentId);
        if (!stillExists) {
          if (routeAgentId && list.some((a) => a.id === routeAgentId)) {
            setSelectedAgentId(routeAgentId);
          } else if (viewMode === "combined") {
            const newest = [...list].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
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

  // --- Create ---
  const [createStatus, setCreateStatus] = useState<AsyncStatus>("idle");
  const [createError, setCreateError] = useState<string | null>(null);

  const createAgent = useCallback(
    async (opts: { name: string; description: string; systemPrompt: string; model: string }) => {
      if (!workspaceId) return;

      const name = opts.name.trim();
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
          description: opts.description.trim() || undefined,
          env_var_keys: [],
          runtime_provider: "openrouter",
          system_prompt: opts.systemPrompt.trim() || undefined,
          model: opts.model.trim() || undefined,
        });

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
    },
    [workspaceId, viewMode, props],
  );

  // --- Delete ---
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
      if (selectedAgentId === selectedAgent.id) setSelectedAgentId("");
      setDeleteStatus("success");
      await refreshAgents();
    } catch (err) {
      setDeleteStatus("error");
      setDeleteError(summarizeError(err));
    }
  }, [refreshAgents, selectedAgent, selectedAgentId]);

  // --- Deploy ---
  const [deployStatus, setDeployStatus] = useState<AsyncStatus>("idle");
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployResult, setDeployResult] = useState<Deployment | null>(null);

  const deploySelected = useCallback(
    async (opts: { invokePath: string; compatibilityDate: string }) => {
      if (!selectedAgent) return;

      setDeployStatus("loading");
      setDeployError(null);
      setDeployResult(null);

      try {
        const deployment = await apiDeployAgent(selectedAgent.id, {
          invokePath: opts.invokePath.trim() || undefined,
          compatibilityDate: opts.compatibilityDate.trim() || undefined,
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
    },
    [refreshAgents, selectedAgent],
  );

  // --- Activate deployment ---
  const [activateStatus, setActivateStatus] = useState<AsyncStatus>("idle");
  const [activateError, setActivateError] = useState<string | null>(null);

  const activateDeployment = useCallback(
    async (deploymentId: string) => {
      if (!selectedAgent) return;
      const id = deploymentId.trim();
      if (!id) return;

      setActivateStatus("loading");
      setActivateError(null);

      try {
        await apiActivateDeployment(selectedAgent.id, id, { reason: "dashboard activation" });
        setActivateStatus("success");
        await refreshAgents();
      } catch (err) {
        setActivateStatus("error");
        setActivateError(summarizeError(err));
      }
    },
    [refreshAgents, selectedAgent],
  );

  // --- Deployments list ---
  const [deploymentsStatus, setDeploymentsStatus] = useState<AsyncStatus>("idle");
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
      const list = await listDeployments(selectedAgent.id, { limit: 50 });
      setDeployments(list);
      setDeploymentsStatus("success");
    } catch (err) {
      setDeploymentsStatus("error");
      setDeploymentsError(summarizeError(err));
    }
  }, [selectedAgent]);

  // --- Telemetry ---
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
      const recent = await listRecentMetrics(selectedAgent.id, { since, limit: 50 });
      setEvents(recent);
      setEventsStatus("success");
    } catch (err) {
      setEventsStatus("error");
      setEventsError(summarizeError(err));
    }
  }, [workspaceId, selectedAgent]);

  // Refresh deployments and telemetry when selection changes
  useEffect(() => {
    if (viewMode === "list") return;

    setDeleteStatus("idle");
    setDeleteError(null);

    void refreshDeployments();
    void refreshUsageAndTelemetry();
  }, [selectedAgentId, refreshDeployments, refreshUsageAndTelemetry, viewMode]);

  // Live telemetry polling
  useEffect(() => {
    if (!workspaceId || viewMode === "list" || !selectedAgent) return;

    const id = setInterval(() => {
      void refreshUsageAndTelemetry();
    }, 5000);
    return () => clearInterval(id);
  }, [workspaceId, refreshUsageAndTelemetry, selectedAgent, viewMode]);

  // --- Helpers ---
  const canUseApi = !!workspaceId;

  const handleCopyId = useCallback(() => {
    if (!selectedAgent) return;
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
  }, [selectedAgent]);

  const handleRefreshDetails = useCallback(() => {
    void refreshAgents();
    void refreshDeployments();
    void refreshUsageAndTelemetry();
  }, [refreshAgents, refreshDeployments, refreshUsageAndTelemetry]);

  // --- Render ---
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
              <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are set in{" "}
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

        <div className={viewMode === "combined" ? "acp-agents-layout" : undefined}>
          <AgentsListPanel
            agents={agents}
            selectedAgentId={selectedAgentId}
            canUseApi={canUseApi}
            viewMode={viewMode}
            onSelectAgent={handleSelectAgent}
            onCreate={createAgent}
            createStatus={createStatus}
            createError={createError}
          />

          <div
            className="acp-agents-detail"
            style={{
              display: viewMode === "list" ? "none" : "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <AgentDetailPanel
              selectedAgent={selectedAgent}
              canUseApi={canUseApi}
              viewMode={viewMode}
              deleteStatus={deleteStatus}
              deleteError={deleteError}
              onDelete={() => void deleteSelectedAgent()}
              onBackToList={handleBackToList}
              onCopyId={handleCopyId}
              onRefreshDetails={handleRefreshDetails}
            />

            <DeployPanel
              selectedAgent={selectedAgent}
              canUseApi={canUseApi}
              deployStatus={deployStatus}
              deployError={deployError}
              deployResult={deployResult}
              onDeploy={(opts) => void deploySelected(opts)}
            />

            <InvokePanel selectedAgent={selectedAgent} canUseApi={canUseApi} />

            <DeploymentsPanel
              selectedAgent={selectedAgent}
              deployments={deployments}
              deploymentsStatus={deploymentsStatus}
              deploymentsError={deploymentsError}
              activateStatus={activateStatus}
              onRefresh={() => void refreshDeployments()}
              onActivate={(id) => void activateDeployment(id)}
            />

            <RollbackPanel
              selectedAgent={selectedAgent}
              canUseApi={canUseApi}
              activateStatus={activateStatus}
              activateError={activateError}
              onActivate={(id) => void activateDeployment(id)}
            />

            <TelemetryPanel
              selectedAgent={selectedAgent}
              usage={usage}
              usageStatus={usageStatus}
              usageError={usageError}
              events={events}
              eventsStatus={eventsStatus}
              eventsError={eventsError}
              onRefresh={() => void refreshUsageAndTelemetry()}
            />
          </div>
        </div>
      </div>
    </>
  );
}
