import React from "react";
import type { Agent, AsyncStatus, Deployment } from "./types";
import { formatDate } from "./utils";

export type DeploymentsPanelProps = {
  selectedAgent: Agent | null;
  deployments: Deployment[];
  deploymentsStatus: AsyncStatus;
  deploymentsError: string | null;
  activateStatus: AsyncStatus;
  onRefresh: () => void;
  onActivate: (deploymentId: string) => void;
};

export default function DeploymentsPanel({
  selectedAgent,
  deployments,
  deploymentsStatus,
  deploymentsError,
  activateStatus,
  onRefresh,
  onActivate,
}: DeploymentsPanelProps): React.ReactElement {
  return (
    <section className="panel" id="deployments">
      <div className="panel-header">
        <div className="row">
          <strong>Deployments</strong>
          <div className="spacer" />
          <span className="badge">
            <span className="muted">agent</span> <code>{selectedAgent?.id ?? "—"}</code>
          </span>
          <button
            className="button"
            onClick={onRefresh}
            disabled={!selectedAgent || deploymentsStatus === "loading"}
          >
            {deploymentsStatus === "loading" ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="panel-body">
        {!selectedAgent ? (
          <div className="muted">Select an agent to see deployments.</div>
        ) : deploymentsStatus === "error" ? (
          <div className="muted" style={{ color: "var(--danger)" }}>{deploymentsError}</div>
        ) : deployments.length === 0 ? (
          <div className="muted">No deployments yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {deployments
              .slice()
              .sort((a, b) => b.version - a.version)
              .map((d) => {
                const isActivePointer = selectedAgent.active_deployment_id === d.id;
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
                    <div className="row" style={{ alignItems: "baseline" }}>
                      <strong style={{ fontFamily: "var(--mono)" }}>v{d.version}</strong>
                      <span className="badge">
                        <span className="muted">status</span> {d.status}
                      </span>
                      <span className="badge">
                        <span className="muted">runtime</span> {d.runtime_provider}
                      </span>
                      {isActivePointer ? (
                        <span className="badge">
                          <span className="muted">active</span> pointer
                        </span>
                      ) : null}
                      <div className="spacer" />
                      <button
                        className="button"
                        onClick={() => onActivate(d.id)}
                        disabled={activateStatus === "loading" || d.status !== "active"}
                        title={d.status !== "active" ? "Only active deployments can be activated" : undefined}
                      >
                        Activate
                      </button>
                    </div>

                    <div style={{ marginTop: 8 }} className="muted">
                      <div><span className="muted">deploymentId:</span> <code>{d.id}</code></div>
                      <div><span className="muted">created:</span> {formatDate(d.created_at)}</div>
                      <div><span className="muted">deployed:</span> {formatDate(d.deployed_at)}</div>
                      <div><span className="muted">finished:</span> {formatDate(d.finished_at)}</div>
                      {d.error_message ? (
                        <div style={{ color: "var(--danger)" }}>{d.error_message}</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </section>
  );
}
