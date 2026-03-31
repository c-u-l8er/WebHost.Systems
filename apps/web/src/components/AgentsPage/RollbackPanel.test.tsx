import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import RollbackPanel from "./RollbackPanel";

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
  active_deployment_id: "d1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

describe("RollbackPanel", () => {
  const defaultProps = {
    selectedAgent: null as any,
    canUseApi: true,
    activateStatus: "idle" as const,
    activateError: null as string | null,
    onActivate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows placeholder when no agent selected", () => {
    render(<RollbackPanel {...defaultProps} />);
    expect(
      screen.getByText("Select an agent to activate a deployment."),
    ).toBeTruthy();
  });

  it("renders deployment ID input and activate button", () => {
    render(<RollbackPanel {...defaultProps} selectedAgent={fakeAgent} />);
    expect(screen.getByPlaceholderText("deployment id")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activate" })).toBeTruthy();
  });

  it("disables activate button when input is empty", () => {
    render(<RollbackPanel {...defaultProps} selectedAgent={fakeAgent} />);
    expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled();
  });

  it("enables activate button when deployment ID entered", async () => {
    render(<RollbackPanel {...defaultProps} selectedAgent={fakeAgent} />);
    await userEvent.type(
      screen.getByPlaceholderText("deployment id"),
      "dep-123",
    );
    expect(screen.getByRole("button", { name: "Activate" })).not.toBeDisabled();
  });

  it("calls onActivate with entered deployment ID", async () => {
    render(<RollbackPanel {...defaultProps} selectedAgent={fakeAgent} />);
    await userEvent.type(
      screen.getByPlaceholderText("deployment id"),
      "dep-456",
    );
    await userEvent.click(screen.getByRole("button", { name: "Activate" }));
    expect(defaultProps.onActivate).toHaveBeenCalledWith("dep-456");
  });

  it("disables controls when canUseApi is false", () => {
    render(
      <RollbackPanel {...defaultProps} selectedAgent={fakeAgent} canUseApi={false} />,
    );
    expect(screen.getByPlaceholderText("deployment id")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled();
  });

  it("shows 'Activating…' during loading", () => {
    render(
      <RollbackPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        activateStatus="loading"
      />,
    );
    expect(screen.getByText("Activating…")).toBeTruthy();
    expect(screen.getByText("Activating…")).toBeDisabled();
  });

  it("shows error message", () => {
    render(
      <RollbackPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        activateStatus="error"
        activateError="Deployment not found"
      />,
    );
    expect(screen.getByText("Deployment not found")).toBeTruthy();
  });
});
