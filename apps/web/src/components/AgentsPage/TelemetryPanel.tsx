import React from "react";
import type { Agent, AsyncStatus, BillingUsage, MetricsEvent } from "./types";
import { clamp, stringifyJson } from "./utils";

export type TelemetryPanelProps = {
  selectedAgent: Agent | null;
  usage: BillingUsage | null;
  usageStatus: AsyncStatus;
  usageError: string | null;
  events: MetricsEvent[];
  eventsStatus: AsyncStatus;
  eventsError: string | null;
  onRefresh: () => void;
};

export default function TelemetryPanel({
  selectedAgent,
  usage,
  usageStatus,
  usageError,
  events,
  eventsStatus,
  eventsError,
  onRefresh,
}: TelemetryPanelProps): React.ReactElement {
  return (
    <section className="panel" id="telemetry">
      <div className="panel-header">
        <div className="row">
          <strong>Telemetry</strong>
          <div className="spacer" />
          <span className="badge">
            <span className="muted">live</span> refresh (5s)
          </span>
          <button
            className="button"
            onClick={onRefresh}
            disabled={usageStatus === "loading" || eventsStatus === "loading"}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="panel-body">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
          <div>
            <div className="row">
              <strong>Current period usage</strong>
              <div className="spacer" />
              {usage ? (
                <span className="badge">
                  <span className="muted">period</span> {usage.period_key}
                </span>
              ) : null}
              {usage ? (
                <span className="badge">
                  <span className="muted">paid</span> {usage.paid ? "yes" : "no"}
                </span>
              ) : null}
            </div>

            {usageStatus === "error" ? (
              <div className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>{usageError}</div>
            ) : null}

            <pre
              style={{
                margin: 0, marginTop: 8, padding: 10, border: "1px solid var(--border)",
                borderRadius: 10, background: "rgba(0,0,0,0.25)", overflowX: "auto", maxHeight: 240,
              }}
            >
              {usage ? stringifyJson(usage) : "—"}
            </pre>
          </div>

          <div>
            <div className="row">
              <strong>Recent events (last hour)</strong>
              <div className="spacer" />
              <span className="badge">
                <span className="muted">agent</span> <code>{selectedAgent?.id ?? "—"}</code>
              </span>
            </div>

            {eventsStatus === "error" ? (
              <div className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>{eventsError}</div>
            ) : null}

            <pre
              style={{
                margin: 0, marginTop: 8, padding: 10, border: "1px solid var(--border)",
                borderRadius: 10, background: "rgba(0,0,0,0.25)", overflowX: "auto", maxHeight: 240,
              }}
            >
              {events.length ? stringifyJson(events.slice(0, clamp(events.length, 1, 10))) : "—"}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
