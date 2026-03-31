import React from "react";

export default function DocsPage(): React.ReactElement {
  return (
    <div className="panel">
      <div className="panel-header">
        <div className="row">
          <div className="brand">
            <div className="brand-title">Documentation</div>
            <div className="brand-subtitle">Spec-first dashboard quick links</div>
          </div>

          <div className="spacer" />

          <span className="badge">
            <span className="muted">status</span> v1 baseline
          </span>
        </div>
      </div>

      <div className="panel-body">
        <div className="muted" style={{ marginBottom: 12 }}>
          This dashboard is intentionally light on embedded docs. The source of
          truth lives in the spec + ADRs.
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            alignItems: "start",
          }}
        >
          <div className="panel" id="spec" style={{ padding: 12 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <strong>Spec v1 (normative)</strong>
              <div className="spacer" />
              <span className="badge">
                <span className="muted">folder</span> docs/spec
              </span>
            </div>

            <div className="row">
              <a
                className="button"
                href="https://github.com/c-u-l8er/WebHost.Systems/tree/main/docs/spec"
                target="_blank"
                rel="noreferrer"
              >
                Open spec v1 on GitHub
              </a>
              <a
                className="button"
                href="https://github.com/c-u-l8er/WebHost.Systems/tree/main/docs/spec/adr"
                target="_blank"
                rel="noreferrer"
              >
                Open ADRs
              </a>
            </div>

            <div className="muted" style={{ marginTop: 10 }}>
              Start with:
              <ul>
                <li>
                  <code>00_MASTER_SPEC.md</code> — architecture + requirements
                </li>
                <li>
                  <code>10_API_CONTRACTS.md</code> — endpoints + error envelope
                </li>
                <li>
                  <code>20_RUNTIME_PROVIDER_INTERFACE.md</code> — adapters + RPI
                </li>
              </ul>
            </div>
          </div>

          <div className="panel" id="quickstart" style={{ padding: 12 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <strong>Quickstart (local)</strong>
              <div className="spacer" />
              <span className="badge">
                <span className="muted">apps</span> web + supabase
              </span>
            </div>

            <div className="muted">
              <div style={{ marginBottom: 10 }}>
                Minimal env vars for the dashboard:
              </div>
              <ul>
                <li>
                  <code>VITE_SUPABASE_URL</code> (from <code>supabase start</code>)
                </li>
                <li>
                  <code>VITE_SUPABASE_ANON_KEY</code> (publishable key)
                </li>
              </ul>

              <div style={{ marginTop: 10 }}>
                Start the shared Supabase instance:
              </div>
              <ul>
                <li>
                  <code>supabase start</code> from the repo root
                </li>
                <li>
                  Edge Functions served automatically via{" "}
                  <code>supabase/functions/</code>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div style={{ height: 12 }} />

        <div className="panel" id="endpoints" style={{ padding: 12 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <strong>Endpoints you can exercise from the UI</strong>
            <div className="spacer" />
            <span className="badge">
              <span className="muted">auth</span> Supabase JWT
            </span>
          </div>

          <div className="muted">
            <ul>
              <li>
                <strong>PostgREST reads:</strong> agents, deployments, metrics,
                billing usage
              </li>
              <li>
                <strong>RPC writes:</strong> create/update/disable/delete agent
              </li>
              <li>
                <strong>Edge Functions:</strong> deploy, invoke, invoke/stream,
                activate-deployment, telemetry, billing-webhook
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
