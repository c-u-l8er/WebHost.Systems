import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  ControlPlaneApiError,
  ControlPlaneClient,
  type Agent,
  type CurrentUsageResponse,
} from "../lib/controlPlaneClient";

/**
 * Read-only Dashboard (Stats Overview)
 *
 * This page is intentionally "overview only":
 * - High-level agent stats (counts by status)
 * - Current billing/usage snapshot
 *
 * Detailed agent operations (create/deploy/invoke/telemetry drilldowns) live on the Agents page.
 */

type AsyncStatus = "idle" | "loading" | "success" | "error";

function summarizeError(err: unknown): string {
  if (err instanceof ControlPlaneApiError) {
    const rid = err.requestId ? ` requestId=${err.requestId}` : "";
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

    return `${err.code}: ${err.message} (${status}${rid}${retryable})${details}`;
  }

  if (err instanceof Error) return err.message;
  return "Unknown error";
}

function formatMs(ms?: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  try {
    return new Intl.NumberFormat().format(n);
  } catch {
    return String(n);
  }
}

function formatUsd(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
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
  const { getToken } = useAuth();

  const controlPlaneUrl = useMemo(() => {
    const raw = import.meta.env.VITE_CONTROL_PLANE_URL;
    return raw ? raw.replace(/\/+$/, "") : "";
  }, []);

  const clerkJwtTemplate = useMemo(() => {
    // Intentionally typed via `any` to avoid requiring a vite-env.d.ts change in this edit.
    const raw = (import.meta as any).env?.VITE_CLERK_JWT_TEMPLATE as
      | string
      | undefined;
    const trimmed = raw?.trim();
    return trimmed ? trimmed : "convex";
  }, []);

  const client = useMemo(() => {
    if (!controlPlaneUrl) return null;

    return new ControlPlaneClient({
      baseUrl: controlPlaneUrl,
      getToken: async () => {
        try {
          if (clerkJwtTemplate === "default") {
            return await getToken();
          }
          return await getToken({ template: clerkJwtTemplate });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Failed to fetch Clerk JWT (template "${clerkJwtTemplate}"). ` +
              `If you see a 404 to /tokens/${clerkJwtTemplate}, create a Clerk JWT template named "${clerkJwtTemplate}" ` +
              `with audience/application ID "convex", or set VITE_CLERK_JWT_TEMPLATE to an existing template name. ` +
              `Underlying error: ${detail}`,
          );
        }
      },
    });
  }, [controlPlaneUrl, getToken, clerkJwtTemplate]);

  const canUseApi = !!client;

  // Agents (read-only)
  const [agentsStatus, setAgentsStatus] = useState<AsyncStatus>("idle");
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);

  // Usage (read-only)
  const [usageStatus, setUsageStatus] = useState<AsyncStatus>("idle");
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usage, setUsage] = useState<CurrentUsageResponse | null>(null);

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
      setAgentsStatus("success");
    } catch (err) {
      setAgentsStatus("error");
      setAgentsError(summarizeError(err));
    }
  }, [client]);

  const refreshUsage = useCallback(async () => {
    if (!client) return;

    setUsageStatus("loading");
    setUsageError(null);

    try {
      const u = await client.getCurrentUsage();
      setUsage(u);
      setUsageStatus("success");
    } catch (err) {
      setUsageStatus("error");
      setUsageError(summarizeError(err));
    }
  }, [client]);

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
    const ready = byStatus.ready ?? 0;
    const draft = byStatus.draft ?? 0;
    const error = byStatus.error ?? 0;
    const disabled = byStatus.disabled ?? 0;

    const withActiveDeployment = agents.filter(
      (a) => !!a.activeDeploymentId,
    ).length;

    const newest = agents.length
      ? agents.slice().sort((a, b) => b.createdAtMs - a.createdAtMs)[0]
      : null;

    const lastUpdated = agents.length
      ? agents.slice().sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0]
      : null;

    return {
      total,
      active,
      deploying,
      ready,
      draft,
      error,
      disabled,
      withActiveDeployment,
      newestCreatedAtMs: newest?.createdAtMs,
      lastUpdatedAtMs: lastUpdated?.updatedAtMs,
    };
  }, [agents]);

  const topAgents = useMemo(() => {
    return agents
      .slice()
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, 12);
  }, [agents]);

  const usageKpis = useMemo(() => {
    const u = usage?.usage;
    return {
      periodKey: usage?.periodKey ?? "—",
      tier: usage?.tier ?? "—",
      requests: u?.requests,
      llmTokens: u?.llmTokens,
      computeMs: u?.computeMs,
      toolCalls: u?.toolCalls,
      costUsdEstimated: u?.costUsdEstimated,
      updatedAtMs: u?.updatedAtMs,
    };
  }, [usage]);

  return (
    <div className="panel">
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
            <span className="muted">control plane</span>{" "}
            <code>{controlPlaneUrl || "(set VITE_CONTROL_PLANE_URL)"}</code>
          </span>

          <button
            className="button"
            onClick={() => void refreshAll()}
            disabled={
              !canUseApi ||
              agentsStatus === "loading" ||
              usageStatus === "loading"
            }
          >
            {agentsStatus === "loading" || usageStatus === "loading"
              ? "Refreshing…"
              : "Refresh"}
          </button>
        </div>
      </div>

      <div className="panel-body">
        {!controlPlaneUrl ? (
          <div className="panel" style={{ padding: 12, marginBottom: 12 }}>
            <div className="muted">
              Set <code>VITE_CONTROL_PLANE_URL</code> in <code>.env.local</code>{" "}
              to your Convex HTTP base URL (e.g.{" "}
              <code>https://&lt;deployment&gt;.convex.site</code>).
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
                  <div className="kpi-label">Ready</div>
                  <div className="kpi-value">
                    {formatNumber(agentCounts.ready)}
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Draft</div>
                  <div className="kpi-value">
                    {formatNumber(agentCounts.draft)}
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
                  {formatMs(agentCounts.newestCreatedAtMs)}
                </span>
                <span className="badge">
                  <span className="muted">last updated</span>{" "}
                  {formatMs(agentCounts.lastUpdatedAtMs)}
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
                      key={a._id}
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
                        {a.activeDeploymentId ? (
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
                          {formatMs(a.updatedAtMs)}
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
                        <code>{a._id}</code>
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
                  <span className="muted">tier</span> {String(usageKpis.tier)}
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
                    {formatNumber(usageKpis.llmTokens)}
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Compute (ms)</div>
                  <div className="kpi-value">
                    {formatNumber(usageKpis.computeMs)}
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Tool calls</div>
                  <div className="kpi-value">
                    {formatNumber(usageKpis.toolCalls)}
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Est. cost</div>
                  <div className="kpi-value">
                    {formatUsd(usageKpis.costUsdEstimated)}
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Updated</div>
                  <div className="kpi-value" style={{ fontSize: 12 }}>
                    {formatMs(usageKpis.updatedAtMs)}
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
                {usage ? JSON.stringify(usage, null, 2) : "—"}
              </pre>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
