import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import TelemetryPanel from "./TelemetryPanel";

const fakeAgent = {
  id: "a1",
  name: "test-agent",
  description: "desc",
  workspace_id: "ws-1",
  created_by: "user-1",
  framework: null,
  status: "active" as const,
  runtime_provider: "openrouter" as const,
  env_var_keys: [],
  provider_config: {},
  system_prompt: null,
  model: null,
  active_deployment_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  last_deployed_at: null,
  last_invocation_at: null,
};

const fakeUsage = {
  id: "bu-1",
  workspace_id: "ws-1",
  period_key: "2026-03",
  period_start: "2026-03-01T00:00:00Z",
  period_end: "2026-03-31T23:59:59Z",
  totals: {
    requests: 142,
    tokens: 50000,
    compute_ms: 120000,
    cost_usd_estimated: 1.5,
  },
  by_runtime: {},
  last_aggregated_at: "2026-03-30T12:00:00Z",
  paid: false,
  created_at: "2026-03-01T00:00:00Z",
};

const fakeEvents = [
  {
    id: "evt-1",
    workspace_id: "ws-1",
    agent_id: "a1",
    deployment_id: null,
    runtime_provider: "openrouter" as const,
    timestamp: "2026-03-30T10:00:00Z",
    requests: 1,
    llm_tokens: 100,
    compute_ms: 500,
    errors: 0,
    error_class: null,
    trace_id: null,
    provider: {},
    cost_usd_estimated: 0.01,
    bucket_key: null,
    created_at: "2026-03-30T10:00:00Z",
  },
  {
    id: "evt-2",
    workspace_id: "ws-1",
    agent_id: "a1",
    deployment_id: null,
    runtime_provider: "openrouter" as const,
    timestamp: "2026-03-30T10:01:00Z",
    requests: 1,
    llm_tokens: 200,
    compute_ms: 1000,
    errors: 0,
    error_class: null,
    trace_id: null,
    provider: {},
    cost_usd_estimated: 0.02,
    bucket_key: null,
    created_at: "2026-03-30T10:01:00Z",
  },
];

describe("TelemetryPanel", () => {
  const defaultProps = {
    selectedAgent: null as any,
    usage: null as any,
    usageStatus: "idle" as const,
    usageError: null as string | null,
    events: [] as any[],
    eventsStatus: "idle" as const,
    eventsError: null as string | null,
    onRefresh: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders panel header", () => {
    render(<TelemetryPanel {...defaultProps} />);
    expect(screen.getByText("Telemetry")).toBeTruthy();
    expect(screen.getByText("Current period usage")).toBeTruthy();
    expect(screen.getByText("Recent events (last hour)")).toBeTruthy();
  });

  it("shows dash when no usage data", () => {
    render(<TelemetryPanel {...defaultProps} />);
    // The pre element should show "—" for both usage and events
    const pres = screen.getAllByText("—");
    expect(pres.length).toBeGreaterThanOrEqual(2);
  });

  it("displays usage data when available", () => {
    render(
      <TelemetryPanel
        {...defaultProps}
        usage={fakeUsage}
        usageStatus="success"
      />,
    );
    expect(screen.getByText("2026-03")).toBeTruthy();
    expect(screen.getByText("no")).toBeTruthy(); // paid: false → "no"
  });

  it("displays events when available", () => {
    render(
      <TelemetryPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        events={fakeEvents}
        eventsStatus="success"
      />,
    );
    // Events are rendered as JSON in a <pre> — check that the pre doesn't show "—"
    const pres = document.querySelectorAll("pre");
    const eventsPreContent = pres[1]?.textContent ?? "";
    expect(eventsPreContent).not.toBe("—");
    expect(eventsPreContent).toContain("evt-1");
  });

  it("shows usage error", () => {
    render(
      <TelemetryPanel
        {...defaultProps}
        usageStatus="error"
        usageError="Billing service unavailable"
      />,
    );
    expect(screen.getByText("Billing service unavailable")).toBeTruthy();
  });

  it("shows events error", () => {
    render(
      <TelemetryPanel
        {...defaultProps}
        eventsStatus="error"
        eventsError="Metrics query timeout"
      />,
    );
    expect(screen.getByText("Metrics query timeout")).toBeTruthy();
  });

  it("calls onRefresh when Refresh clicked", async () => {
    render(<TelemetryPanel {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables refresh during loading", () => {
    render(
      <TelemetryPanel {...defaultProps} usageStatus="loading" />,
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
  });

  it("shows agent ID in events header", () => {
    render(
      <TelemetryPanel {...defaultProps} selectedAgent={fakeAgent} />,
    );
    expect(screen.getByText("a1")).toBeTruthy();
  });
});
