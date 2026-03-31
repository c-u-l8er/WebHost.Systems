import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import DeploymentsPanel from "./DeploymentsPanel";

const fakeAgent = {
  id: "a1",
  name: "test-agent",
  description: "desc",
  workspace_id: "ws-1",
  status: "active" as const,
  runtime_provider: "openrouter" as const,
  env_var_keys: [],
  system_prompt: "You are helpful",
  model: "anthropic/claude-sonnet-4-20250514",
  active_deployment_id: "d2",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

const fakeDeployments = [
  {
    id: "d1",
    agent_id: "a1",
    version: 1,
    status: "active",
    runtime_provider: "openrouter",
    provider_ref: {},
    invoke_url: null,
    deployed_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:01:00Z",
    created_at: "2026-01-01T00:00:00Z",
    error_message: null,
  },
  {
    id: "d2",
    agent_id: "a1",
    version: 2,
    status: "active",
    runtime_provider: "openrouter",
    provider_ref: {},
    invoke_url: null,
    deployed_at: "2026-02-01T00:00:00Z",
    finished_at: "2026-02-01T00:01:00Z",
    created_at: "2026-02-01T00:00:00Z",
    error_message: null,
  },
];

describe("DeploymentsPanel", () => {
  const defaultProps = {
    selectedAgent: null as any,
    deployments: [] as any[],
    deploymentsStatus: "idle" as const,
    deploymentsError: null as string | null,
    activateStatus: "idle" as const,
    onRefresh: vi.fn(),
    onActivate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows placeholder when no agent selected", () => {
    render(<DeploymentsPanel {...defaultProps} />);
    expect(screen.getByText("Select an agent to see deployments.")).toBeTruthy();
  });

  it("shows 'No deployments yet' when empty", () => {
    render(
      <DeploymentsPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deploymentsStatus="success"
      />,
    );
    expect(screen.getByText("No deployments yet.")).toBeTruthy();
  });

  it("renders deployment list sorted by version (descending)", () => {
    render(
      <DeploymentsPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deployments={fakeDeployments}
        deploymentsStatus="success"
      />,
    );
    const versions = screen.getAllByText(/^v\d+$/);
    expect(versions[0].textContent).toBe("v2");
    expect(versions[1].textContent).toBe("v1");
  });

  it("shows 'active pointer' badge for the active deployment", () => {
    render(
      <DeploymentsPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deployments={fakeDeployments}
        deploymentsStatus="success"
      />,
    );
    // d2 is the active deployment
    expect(screen.getByText("pointer")).toBeTruthy();
  });

  it("calls onActivate when Activate button clicked", async () => {
    render(
      <DeploymentsPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deployments={fakeDeployments}
        deploymentsStatus="success"
      />,
    );
    const activateButtons = screen.getAllByRole("button", { name: "Activate" });
    await userEvent.click(activateButtons[0]); // First one is v2
    expect(defaultProps.onActivate).toHaveBeenCalledWith("d2");
  });

  it("disables activate button when deployment status is not active", () => {
    const deps = [
      { ...fakeDeployments[0], status: "pending" },
    ];
    render(
      <DeploymentsPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deployments={deps}
        deploymentsStatus="success"
      />,
    );
    const btn = screen.getByRole("button", { name: "Activate" });
    expect(btn).toBeDisabled();
  });

  it("disables activate buttons during activation", () => {
    render(
      <DeploymentsPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deployments={fakeDeployments}
        deploymentsStatus="success"
        activateStatus="loading"
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "Activate" });
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it("calls onRefresh when Refresh clicked", async () => {
    render(
      <DeploymentsPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deploymentsStatus="success"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows loading state", () => {
    render(
      <DeploymentsPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deploymentsStatus="loading"
      />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("shows error state", () => {
    render(
      <DeploymentsPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deploymentsStatus="error"
        deploymentsError="Failed to load"
      />,
    );
    expect(screen.getByText("Failed to load")).toBeTruthy();
  });

  it("shows error message on deployment with error_message", () => {
    const deps = [
      { ...fakeDeployments[0], error_message: "Build failed: timeout" },
    ];
    render(
      <DeploymentsPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deployments={deps}
        deploymentsStatus="success"
      />,
    );
    expect(screen.getByText("Build failed: timeout")).toBeTruthy();
  });
});
