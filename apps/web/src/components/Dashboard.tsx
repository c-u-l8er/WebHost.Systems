import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../lib/WorkspaceProvider";
import {
  ApiError,
  listAgents,
  getBillingUsage,
  type Agent,
  type BillingUsage,
} from "../lib/supabaseApi";

type AsyncStatus = "idle" | "loading" | "success" | "error";

function summarizeError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code}: ${err.message} (status=${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

function formatTs(ts?: string | null): string {
  if (!ts) return "\u2014";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return "\u2014";
  try {
    return new Intl.NumberFormat().format(n);
  } catch {
    return String(n);
  }
}

function formatUsd(n: number | undefined | null): string {
  if (n === undefined || n === null) return "\u2014";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 4,
    }).format(n);
  } catch {
    return String(n);
  }
}

export default function Dashboard(): React.ReactElement {
  const { workspace } = useWorkspace();

  const [agentsStatus, setAgentsStatus] = useState<AsyncStatus>("idle");
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [usageStatus, setUsageStatus] = useState<AsyncStatus>("idle");
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usage, setUsage] = useState<BillingUsage | null>(null);

  const refreshAgents = useCallback(async () => {
    if (!workspace) return;
    setAgentsStatus("loading");
    setAgentsError(null);
    try {
      const list = await listAgents(workspace.id, { limit: 200 });
      setAgents(list);
      setAgentsStatus("success");
    } catch (err) {
      setAgentsStatus("error");
      setAgentsError(summarizeError(err));
    }
  }, [workspace]);

  const refreshUsage = useCallback(async () => {
    if (!workspace) return;
    setUsageStatus("loading");
    setUsageError(null);
    try {
      const u = await getBillingUsage(workspace.id);
      setUsage(u);
      setUsageStatus("success");
    } catch (err) {
      setUsageStatus("error");
      setUsageError(summarizeError(err));
    }
  }, [workspace]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshAgents(), refreshUsage()]);
  }, [refreshAgents, refreshUsage]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const agentCounts = useMemo(() => {
    const byStatus: Record<string, number> = {};
    for (const a of agents) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    }

    const total = agents.length;
    const active = byStatus.active ?? 0;
    const deploying = byStatus.deploying ?? 0;
    const created = byStatus.created ?? 0;
    const error = byStatus.error ?? 0;
    const disabled = byStatus.disabled ?? 0;

    const withActiveDeployment = agents.filter(
      (a) => !!a.active_deployment_id,
    ).length;

    const newest = agents.length
      ? agents.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
      : null;

    const lastUpdated = agents.length
      ? agents.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
      : null;

    return {
      total,
      active,
      deploying,
      created,
      error,
      disabled,
      withActiveDeployment,
      newestCreatedAt: newest?.created_at,
      lastUpdatedAt: lastUpdated?.updated_at,
    };
  }, [agents]);

  const topAgents = useMemo(() => {
    return agents
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 12);
  }, [agents]);

  const usageKpis = useMemo(() => {
    const t = usage?.totals;
    return {
      periodKey: usage?.period_key ?? "\u2014",
      requests: t?.requests,
      tokens: t?.tokens,
      computeMs: t?.compute_ms,
      costUsdEstimated: t?.cost_usd_estimated,
      lastAggregatedAt: usage?.last_aggregated_at,
    };
  }, [usage]);

  return (
    <div>
      <div className="panel" style={{ marginBottom: "12px" }}>
        <div className="panel-header">
          <div className="row">
            <div className="brand">
              <div className="brand-title">Dashboard</div>
              <div className="brand-subtitle">
                Read-only overview — agents and usage
              </div>
            </div>

            <div className="spacer" />

            <span className="badge">
              <span className="muted">workspace</span>{" "}
              <code>{workspace?.name ?? "(none)"}</code>
            </span>

            <button
              className="button"
              onClick={() => void refreshAll()}
              disabled={
                !workspace ||
                agentsStatus === "loading" ||
                usageStatus === "loading"
              }
            >
              {agentsStatus === "loading" || usageStatus === "loading"
                ? "Refreshing\u2026"
                : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      {!workspace ? (
        <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
          <div className="muted">
            No workspace found. One will be auto-created on next page load.
          </div>
        </div>
      ) : null}

      {(agentsError || usageError) && (
        <div
          style={{
            marginBottom: 12,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {agentsError ? (
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
          ) : null}
          {usageError ? (
            <div
              className="badge"
              style={{
                borderColor: "rgba(255, 107, 107, 0.6)",
                background: "rgba(255, 107, 107, 0.08)",
              }}
            >
              <span style={{ color: "var(--danger)" }}>Usage error:</span>{" "}
              <span>{usageError}</span>
            </div>
          ) : null}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 0.8fr",
          gap: 12,
          alignItems: "start",
        }}
      >
        {/* Agents overview */}
        <section className="panel" aria-label="Agent stats">
          <div className="panel-header">
            <div className="row">
              <strong>Agents</strong>
              <div className="spacer" />
              <span className="badge">
                <span className="muted">total</span>{" "}
                {formatNumber(agentCounts.total)}
              </span>
            </div>
          </div>

          <div className="panel-body">
            <div className="kpi-grid" style={{ marginBottom: 12 }}>
              <div className="kpi">
                <div className="kpi-label">Active</div>
                <div className="kpi-value">
                  {formatNumber(agentCounts.active)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Deploying</div>
                <div className="kpi-value">
                  {formatNumber(agentCounts.deploying)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Created</div>
                <div className="kpi-value">
                  {formatNumber(agentCounts.created)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Error</div>
                <div className="kpi-value">
                  {formatNumber(agentCounts.error)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Disabled</div>
                <div className="kpi-value">
                  {formatNumber(agentCounts.disabled)}
                </div>
              </div>
            </div>

            <div className="row" style={{ marginBottom: 10 }}>
              <span className="badge">
                <span className="muted">with active deployment</span>{" "}
                {formatNumber(agentCounts.withActiveDeployment)}
              </span>
              <span className="badge">
                <span className="muted">newest</span>{" "}
                {formatTs(agentCounts.newestCreatedAt)}
              </span>
              <span className="badge">
                <span className="muted">last updated</span>{" "}
                {formatTs(agentCounts.lastUpdatedAt)}
              </span>
            </div>

            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Recently updated agents
            </div>

            {topAgents.length === 0 ? (
              <div className="muted">No agents yet.</div>
            ) : (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                {topAgents.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: 10,
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div className="row" style={{ alignItems: "baseline" }}>
                      <strong>{a.name}</strong>
                      <span className="badge">
                        <span className="muted">status</span> {a.status}
                      </span>
                      {a.active_deployment_id ? (
                        <span className="badge">
                          <span className="muted">active deployment</span> yes
                        </span>
                      ) : (
                        <span className="badge">
                          <span className="muted">active deployment</span> no
                        </span>
                      )}
                      <div className="spacer" />
                      <span className="muted" style={{ fontSize: 12 }}>
                        {formatTs(a.updated_at)}
                      </span>
                    </div>

                    {a.description ? (
                      <div
                        className="muted"
                        style={{ marginTop: 6, fontSize: 13 }}
                      >
                        {a.description}
                      </div>
                    ) : null}

                    <div
                      className="muted"
                      style={{ marginTop: 6, fontSize: 12 }}
                    >
                      <span className="muted">agentId:</span>{" "}
                      <code>{a.id}</code>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Usage overview */}
        <section className="panel" aria-label="Usage stats">
          <div className="panel-header">
            <div className="row">
              <strong>Usage</strong>
              <div className="spacer" />
              <span className="badge">
                <span className="muted">period</span> {usageKpis.periodKey}
              </span>
              <span className="badge">
                <span className="muted">plan</span> {workspace?.plan ?? "\u2014"}
              </span>
            </div>
          </div>

          <div className="panel-body">
            <div className="kpi-grid" style={{ marginBottom: 12 }}>
              <div className="kpi">
                <div className="kpi-label">Requests</div>
                <div className="kpi-value">
                  {formatNumber(usageKpis.requests)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">LLM tokens</div>
                <div className="kpi-value">
                  {formatNumber(usageKpis.tokens)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Compute (ms)</div>
                <div className="kpi-value">
                  {formatNumber(usageKpis.computeMs)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Est. cost</div>
                <div className="kpi-value">
                  {formatUsd(usageKpis.costUsdEstimated)}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Aggregated</div>
                <div className="kpi-value" style={{ fontSize: 12 }}>
                  {formatTs(usageKpis.lastAggregatedAt)}
                </div>
              </div>
            </div>

            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Raw usage snapshot
            </div>

            <pre
              style={{
                margin: 0,
                padding: 10,
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "rgba(0,0,0,0.25)",
                overflowX: "auto",
                maxHeight: 320,
              }}
            >
              {usage ? JSON.stringify(usage, null, 2) : "\u2014"}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
