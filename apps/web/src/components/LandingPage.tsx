import React from "react";
import { SignInButton, SignUpButton } from "@clerk/clerk-react";

export type LandingPageProps = {
  /**
   * Optional: show a compact variant (useful if you embed this in a smaller panel).
   */
  variant?: "default" | "compact";

  /**
   * Optional: if you want to override the headline from the parent.
   */
  headline?: string;

  /**
   * Optional: if you want to override the subheadline from the parent.
   */
  subheadline?: string;
};

export default function LandingPage({
  variant = "default",
  headline = "Deploy, run, and observe AI agents across runtimes.",
  subheadline = "webhost.systems gives you deployments, invocations, telemetry, usage, and limits — with a multi-runtime foundation.",
}: LandingPageProps): React.ReactElement {
  const isCompact = variant === "compact";

  return (
    <div style={{ padding: isCompact ? 0 : 6 }}>
      {/* Hero */}
      <section
        className="panel"
        style={{
          padding: isCompact ? 14 : 18,
          background:
            "radial-gradient(1200px 500px at 20% 0%, rgba(110, 168, 254, 0.18), transparent 60%), var(--panel)",
        }}
      >
        <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
          <div className="brand" style={{ gap: 6 }}>
            <div className="brand-title" style={{ fontSize: 16 }}>
              WebHost.Systems
            </div>
            <div className="brand-subtitle">
              Control plane for multi-runtime agent hosting
            </div>
          </div>
          <div className="spacer" />
          <div className="row" style={{ gap: 10 }}>
            <SignInButton>
              <button className="button" type="button">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton>
              <button className="button button-primary" type="button">
                Get started
              </button>
            </SignUpButton>
          </div>
        </div>

        <div style={{ height: 14 }} />

        <h1
          style={{
            margin: 0,
            fontSize: isCompact ? 22 : 28,
            lineHeight: 1.15,
            letterSpacing: -0.2,
          }}
        >
          {headline}
        </h1>

        <div style={{ height: 10 }} />

        <p
          className="muted"
          style={{
            margin: 0,
            fontSize: isCompact ? 13 : 14,
            maxWidth: 820,
          }}
        >
          {subheadline}
        </p>

        <div style={{ height: 16 }} />

        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="badge">
            <span className="muted">default runtime</span> Cloudflare Workers/DO
          </span>
          <span className="badge">
            <span className="muted">premium runtime</span> AWS AgentCore
          </span>
          <span className="badge">
            <span className="muted">protocol</span> invoke/v1 + SSE streaming
          </span>
          <span className="badge">
            <span className="muted">telemetry</span> signed, deployment-scoped
          </span>
          <span className="badge">
            <span className="muted">deployments</span> immutable + rollback
          </span>
        </div>

        <div style={{ height: 14 }} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isCompact ? "1fr" : "1.2fr 0.8fr",
            gap: 12,
            alignItems: "start",
          }}
        >
          <div
            className="panel"
            style={{ padding: 14, background: "var(--panel-2)" }}
          >
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              What you get
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Agent CRUD with tenant isolation</li>
              <li>Deploy orchestration with audit-friendly history</li>
              <li>Invocation gateway (non-streaming + SSE)</li>
              <li>Usage + recent telemetry visibility in the dashboard</li>
              <li>Tier entitlements, runtime gating, and request limits</li>
            </ul>
          </div>

          <div
            className="panel"
            style={{ padding: 14, background: "var(--panel-2)" }}
          >
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Designed for engineering reality
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <strong>Multi-runtime by design</strong>
                <div className="muted" style={{ marginTop: 4 }}>
                  Keep your control plane stable while choosing the right
                  runtime per workload.
                </div>
              </div>
              <div>
                <strong>Integrity-first telemetry</strong>
                <div className="muted" style={{ marginTop: 4 }}>
                  Events are HMAC-signed per deployment and ownership is
                  cross-checked at ingestion.
                </div>
              </div>
              <div>
                <strong>Rollback without redeploy</strong>
                <div className="muted" style={{ marginTop: 4 }}>
                  Activate an older deployment by flipping an active pointer.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div style={{ height: 12 }} />

      {/* Feature grid */}
      <section className="panel" id="product">
        <div className="panel-header">
          <div className="row">
            <strong>Why webhost.systems</strong>
            <div className="spacer" />
            <span className="muted" style={{ fontSize: 12 }}>
              v1 foundation — fast iteration, strong invariants
            </span>
          </div>
        </div>
        <div className="panel-body">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isCompact ? "1fr" : "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            <FeatureCard
              title="Professional deployments"
              body="Immutable deployment records, deterministic routing through a single active pointer, and clear status transitions."
            />
            <FeatureCard
              title="Unified invocation contract"
              body='One canonical protocol: "invoke/v1". Use prompt or messages, plus SSE streaming for responsive UX.'
            />
            <FeatureCard
              title="Security and billing integrity"
              body="Telemetry events are signed per deployment. Limits and runtime gating are enforced server-side (defense in depth)."
            />
          </div>
        </div>
      </section>

      <div style={{ height: 12 }} />

      {/* How it works */}
      <section className="panel" id="how-it-works">
        <div className="panel-header">
          <strong>How it works</strong>
        </div>
        <div className="panel-body">
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <strong>Create an agent</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                Define the agent’s metadata and (optionally) required env keys.
              </div>
            </li>
            <li style={{ marginTop: 10 }}>
              <strong>Deploy</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                Produce a deployment record and orchestrate runtime provider
                resources.
              </div>
            </li>
            <li style={{ marginTop: 10 }}>
              <strong>Invoke</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                The gateway routes via the agent’s active deployment. Streaming
                uses SSE with ordered events.
              </div>
            </li>
            <li style={{ marginTop: 10 }}>
              <strong>Observe usage</strong>
              <div className="muted" style={{ marginTop: 4 }}>
                Signed telemetry is ingested and aggregated for usage, limits,
                and cost estimates.
              </div>
            </li>
          </ol>
        </div>
      </section>

      <div style={{ height: 12 }} />

      {/* Pricing */}
      <section className="panel" id="pricing">
        <div className="panel-header">
          <div className="row">
            <strong>Pricing</strong>
            <div className="spacer" />
            <span className="muted" style={{ fontSize: 12 }}>
              Spec-aligned tiers (final numbers TBD)
            </span>
          </div>
        </div>
        <div className="panel-body">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isCompact ? "1fr" : "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            <div
              className="panel"
              style={{ padding: 14, background: "var(--panel-2)" }}
            >
              <div style={{ fontWeight: 700 }}>Free</div>
              <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                Get started on Cloudflare Workers/DO with request limits and
                basic usage visibility.
              </div>
            </div>
            <div
              className="panel"
              style={{ padding: 14, background: "var(--panel-2)" }}
            >
              <div style={{ fontWeight: 700 }}>Pro</div>
              <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                Higher limits, better retention, and more operational headroom.
              </div>
            </div>
            <div
              className="panel"
              style={{ padding: 14, background: "var(--panel-2)" }}
            >
              <div style={{ fontWeight: 700 }}>Enterprise</div>
              <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                AgentCore runtime access and capability gating with stronger
                controls.
              </div>
            </div>
          </div>

          <div className="muted" style={{ marginTop: 10 }}>
            Limits, entitlements, and runtime gating are enforced server-side;
            telemetry is integrity-protected.
          </div>
        </div>
      </section>

      <div style={{ height: 12 }} />

      {/* Footer / CTA */}
      <section
        className="panel"
        style={{
          padding: 14,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.02), transparent), var(--panel)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isCompact ? "1fr" : "1fr auto",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div>
            <strong>Ready to try the dashboard?</strong>
            <div className="muted" style={{ marginTop: 6 }}>
              Sign up to create an agent, deploy to Cloudflare, invoke via the
              gateway, and view usage/telemetry.
            </div>
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <SignUpButton>
              <button className="button button-primary" type="button">
                Create account
              </button>
            </SignUpButton>
          </div>
        </div>
      </section>

      <div style={{ height: 10 }} />

      <div className="muted" style={{ fontSize: 12, textAlign: "center" }}>
        © {new Date().getFullYear()} WebHost.Systems ... Powered by <a href="https://ampersandboxdesign.com">[&]</a>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  body,
}: {
  title: string;
  body: string;
}): React.ReactElement {
  return (
    <div
      className="panel"
      style={{
        padding: 14,
        background: "var(--panel-2)",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div className="muted" style={{ fontSize: 13 }}>
        {body}
      </div>
    </div>
  );
}
