import React, { useState } from "react";
import type { Agent, AsyncStatus, Deployment } from "./types";
import { stringifyJson } from "./utils";

export type DeployPanelProps = {
  selectedAgent: Agent | null;
  canUseApi: boolean;
  deployStatus: AsyncStatus;
  deployError: string | null;
  deployResult: Deployment | null;
  onDeploy: (opts: { invokePath: string; compatibilityDate: string }) => void;
};

export default function DeployPanel({
  selectedAgent,
  canUseApi,
  deployStatus,
  deployError,
  deployResult,
  onDeploy,
}: DeployPanelProps): React.ReactElement {
  const [invokePath, setInvokePath] = useState("/invoke");
  const [compatibilityDate, setCompatibilityDate] = useState("");

  return (
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
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              This deploy uses the built-in deterministic Cloudflare Worker template unless you add artifact packaging later.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>invokePath</div>
                <input
                  className="button"
                  style={{ width: "100%", textAlign: "left" }}
                  value={invokePath}
                  onChange={(e) => setInvokePath(e.target.value)}
                  placeholder="/invoke"
                  disabled={!canUseApi || deployStatus === "loading"}
                />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>compatibilityDate (optional)</div>
                <input
                  className="button"
                  style={{ width: "100%", textAlign: "left" }}
                  value={compatibilityDate}
                  onChange={(e) => setCompatibilityDate(e.target.value)}
                  placeholder="2026-01-01"
                  disabled={!canUseApi || deployStatus === "loading"}
                />
              </div>
            </div>

            <div style={{ height: 10 }} />

            <div className="row">
              <button
                className="button button-primary"
                onClick={() => onDeploy({ invokePath, compatibilityDate })}
                disabled={!canUseApi || deployStatus === "loading"}
              >
                {deployStatus === "loading" ? "Deploying…" : "Deploy"}
              </button>

              {deployError ? (
                <span
                  className="badge"
                  style={{ borderColor: "rgba(255, 107, 107, 0.6)", background: "rgba(255, 107, 107, 0.08)" }}
                >
                  <span style={{ color: "var(--danger)" }}>error</span> {deployError}
                </span>
              ) : null}
            </div>

            {deployResult ? (
              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Deployment created (async finalize)</div>
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
  );
}
