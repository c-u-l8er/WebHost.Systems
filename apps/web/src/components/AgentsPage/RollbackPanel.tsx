import React, { useState } from "react";
import type { Agent, AsyncStatus } from "./types";

export type RollbackPanelProps = {
  selectedAgent: Agent | null;
  canUseApi: boolean;
  activateStatus: AsyncStatus;
  activateError: string | null;
  onActivate: (deploymentId: string) => void;
};

export default function RollbackPanel({
  selectedAgent,
  canUseApi,
  activateStatus,
  activateError,
  onActivate,
}: RollbackPanelProps): React.ReactElement {
  const [deploymentId, setDeploymentId] = useState("");

  return (
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
          <div className="muted">Select an agent to activate a deployment.</div>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Enter a <code>deploymentId</code> to activate. This updates{" "}
              <code>agents.active_deployment_id</code>.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
              <input
                className="button"
                style={{ width: "100%", textAlign: "left" }}
                value={deploymentId}
                onChange={(e) => setDeploymentId(e.target.value)}
                placeholder="deployment id"
                disabled={!canUseApi || activateStatus === "loading"}
              />
              <button
                className="button"
                onClick={() => onActivate(deploymentId)}
                disabled={!canUseApi || activateStatus === "loading" || !deploymentId.trim()}
              >
                {activateStatus === "loading" ? "Activating…" : "Activate"}
              </button>
            </div>

            {activateError ? (
              <div style={{ marginTop: 10 }}>
                <span
                  className="badge"
                  style={{ borderColor: "rgba(255, 107, 107, 0.6)", background: "rgba(255, 107, 107, 0.08)" }}
                >
                  <span style={{ color: "var(--danger)" }}>error</span> {activateError}
                </span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
