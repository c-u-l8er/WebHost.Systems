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
  status: "active" as const,
  runtime_provider: "openrouter" as const,
  env_var_keys: [],
  system_prompt: null,
  model: null,
  active_deployment_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

const fakeUsage = {
  id: "bu-1",
  workspace_id: "ws-1",
  period_key: "2026-03",
  total_requests: 142,
  total_tokens: 50000,
  total_compute_ms: 120000,
  paid: false,
};

const fakeEvents = [
  {
    id: "evt-1",
    agent_id: "a1",
    event_type: "invoke",
    timestamp: "2026-03-30T10:00:00Z",
    payload: { tokens: 100, computeMs: 500 },
  },
  {
    id: "evt-2",
    agent_id: "a1",
    event_type: "invoke",
    timestamp: "2026-03-30T10:01:00Z",
    payload: { tokens: 200, computeMs: 1000 },
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
