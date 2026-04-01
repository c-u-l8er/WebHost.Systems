import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import DeployPanel from "./DeployPanel";

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
  system_prompt: "You are helpful",
  model: "anthropic/claude-sonnet-4-20250514",
  active_deployment_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  last_deployed_at: null,
  last_invocation_at: null,
};

const fakeDeployment = {
  id: "d1",
  agent_id: "a1",
  version: 1,
  status: "active",
  provider_ref: {},
  invoke_url: "https://example.com/invoke",
  created_at: "2026-01-01T00:00:00Z",
  activated_at: "2026-01-01T00:00:00Z",
};

describe("DeployPanel", () => {
  const mockOnDeploy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows placeholder when no agent selected", () => {
    render(
      <DeployPanel
        selectedAgent={null}
        canUseApi={true}
        deployStatus="idle"
        deployError={null}
        deployResult={null}
        onDeploy={mockOnDeploy}
      />,
    );
    expect(screen.getByText("Select an agent to deploy.")).toBeTruthy();
  });

  it("renders deploy form when agent selected", () => {
    render(
      <DeployPanel
        selectedAgent={fakeAgent}
        canUseApi={true}
        deployStatus="idle"
        deployError={null}
        deployResult={null}
        onDeploy={mockOnDeploy}
      />,
    );
    expect(screen.getByText("Deploy")).toBeTruthy();
    expect(screen.getByPlaceholderText("/invoke")).toBeTruthy();
    expect(screen.getByPlaceholderText("2026-01-01")).toBeTruthy();
  });

  it("calls onDeploy with default values when Deploy clicked", async () => {
    render(
      <DeployPanel
        selectedAgent={fakeAgent}
        canUseApi={true}
        deployStatus="idle"
        deployError={null}
        deployResult={null}
        onDeploy={mockOnDeploy}
      />,
    );

    await userEvent.click(screen.getByText("Deploy"));

    expect(mockOnDeploy).toHaveBeenCalledWith({
      invokePath: "/invoke",
      compatibilityDate: "",
    });
  });

  it("passes custom form values to onDeploy", async () => {
    render(
      <DeployPanel
        selectedAgent={fakeAgent}
        canUseApi={true}
        deployStatus="idle"
        deployError={null}
        deployResult={null}
        onDeploy={mockOnDeploy}
      />,
    );

    const pathInput = screen.getByPlaceholderText("/invoke");
    const dateInput = screen.getByPlaceholderText("2026-01-01");

    await userEvent.clear(pathInput);
    await userEvent.type(pathInput, "/api/v2/invoke");
    await userEvent.type(dateInput, "2026-03-30");

    await userEvent.click(screen.getByText("Deploy"));

    expect(mockOnDeploy).toHaveBeenCalledWith({
      invokePath: "/api/v2/invoke",
      compatibilityDate: "2026-03-30",
    });
  });

  it("disables button when canUseApi is false", () => {
    render(
      <DeployPanel
        selectedAgent={fakeAgent}
        canUseApi={false}
        deployStatus="idle"
        deployError={null}
        deployResult={null}
        onDeploy={mockOnDeploy}
      />,
    );

    expect(screen.getByText("Deploy")).toBeDisabled();
  });

  it("shows loading state during deployment", () => {
    render(
      <DeployPanel
        selectedAgent={fakeAgent}
        canUseApi={true}
        deployStatus="loading"
        deployError={null}
        deployResult={null}
        onDeploy={mockOnDeploy}
      />,
    );

    expect(screen.getByText("Deploying…")).toBeTruthy();
    expect(screen.getByText("Deploying…")).toBeDisabled();
  });

  it("shows error message when deployError is set", () => {
    render(
      <DeployPanel
        selectedAgent={fakeAgent}
        canUseApi={true}
        deployStatus="error"
        deployError="Worker deployment failed"
        deployResult={null}
        onDeploy={mockOnDeploy}
      />,
    );

    expect(screen.getByText("Worker deployment failed")).toBeTruthy();
  });

  it("shows deployment result when deployResult is set", () => {
    render(
      <DeployPanel
        selectedAgent={fakeAgent}
        canUseApi={true}
        deployStatus="success"
        deployError={null}
        deployResult={fakeDeployment as any}
        onDeploy={mockOnDeploy}
      />,
    );

    expect(screen.getByText("Deployment created (async finalize)")).toBeTruthy();
  });
});
