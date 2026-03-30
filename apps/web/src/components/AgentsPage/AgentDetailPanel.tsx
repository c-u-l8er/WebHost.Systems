import React from "react";
import type { Agent, AsyncStatus } from "./types";
import { formatDate } from "./utils";

export type AgentDetailPanelProps = {
  selectedAgent: Agent | null;
  canUseApi: boolean;
  viewMode: "list" | "detail" | "combined";
  deleteStatus: AsyncStatus;
  deleteError: string | null;
  onDelete: () => void;
  onBackToList: () => void;
  onCopyId: () => void;
  onRefreshDetails: () => void;
};

export default function AgentDetailPanel({
  selectedAgent,
  canUseApi,
  viewMode,
  deleteStatus,
  deleteError,
  onDelete,
  onBackToList,
  onCopyId,
  onRefreshDetails,
}: AgentDetailPanelProps): React.ReactElement {
  return (
    <section className="panel" id="agent">
      <div className="panel-header">
        <div className="row">
          <button
            className="button"
            type="button"
            onClick={onBackToList}
            style={{ display: viewMode === "detail" ? "inline-flex" : "none" }}
            title="Back to agents list"
          >
            &larr; Back
          </button>

          <strong>Selected agent</strong>

          <div className="spacer" />

          {selectedAgent ? (
            <div className="row" style={{ gap: 8 }}>
              <button className="button" type="button" onClick={onCopyId} title="Copy agent id">
                Copy ID
              </button>
              <button className="button" type="button" onClick={onRefreshDetails} title="Refresh agent details (deployments + usage + telemetry)">
                Refresh details
              </button>
              <a className="button" href="#deployments" title="Jump to deployments">
                Deployments &darr;
              </a>
            </div>
          ) : null}

          {selectedAgent ? (
            <span className="badge">
              <span className="muted">status</span> {selectedAgent.status}
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
          <div className="muted">Select an agent to deploy/invoke.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Agent ID</div>
                <div><code>{selectedAgent.id}</code></div>
                <div style={{ height: 8 }} />
                <div className="muted" style={{ fontSize: 12 }}>Active deployment</div>
                <div><code>{selectedAgent.active_deployment_id ?? "(none)"}</code></div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>Created</div>
                <div>{formatDate(selectedAgent.created_at)}</div>
                <div style={{ height: 8 }} />
                <div className="muted" style={{ fontSize: 12 }}>Updated</div>
                <div>{formatDate(selectedAgent.updated_at)}</div>
              </div>
            </div>

            <div className="row">
              <button
                className="button button-danger"
                onClick={onDelete}
                disabled={!canUseApi || deleteStatus === "loading"}
                title="Delete agent and remove all deployments"
              >
                {deleteStatus === "loading" ? "Deleting…" : "Delete agent"}
              </button>

              {deleteError ? (
                <span
                  className="badge"
                  style={{ borderColor: "rgba(255, 107, 107, 0.6)", background: "rgba(255, 107, 107, 0.08)" }}
                >
                  <span style={{ color: "var(--danger)" }}>error</span> {deleteError}
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
  );
}
