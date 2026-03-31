import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import AgentDetailPanel from "./AgentDetailPanel";

const fakeAgent = {
  id: "a1",
  name: "test-agent",
  description: "A test agent",
  workspace_id: "ws-1",
  status: "active" as const,
  runtime_provider: "openrouter" as const,
  env_var_keys: [],
  system_prompt: "You are helpful",
  model: "anthropic/claude-sonnet-4-20250514",
  active_deployment_id: "dep-1",
  created_at: "2026-01-15T10:30:00Z",
  updated_at: "2026-03-20T14:00:00Z",
  deleted_at: null,
};

describe("AgentDetailPanel", () => {
  const defaultProps = {
    selectedAgent: null as any,
    canUseApi: true,
    viewMode: "combined" as const,
    deleteStatus: "idle" as const,
    deleteError: null as string | null,
    onDelete: vi.fn(),
    onBackToList: vi.fn(),
    onCopyId: vi.fn(),
    onRefreshDetails: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows placeholder when no agent selected", () => {
    render(<AgentDetailPanel {...defaultProps} />);
    expect(screen.getByText("Select an agent to deploy/invoke.")).toBeTruthy();
  });

  it("shows 'none selected' badge when no agent", () => {
    render(<AgentDetailPanel {...defaultProps} />);
    expect(screen.getByText("none selected")).toBeTruthy();
  });

  it("displays agent details when selected", () => {
    render(<AgentDetailPanel {...defaultProps} selectedAgent={fakeAgent} />);
    expect(screen.getByText("a1")).toBeTruthy();
    expect(screen.getByText("dep-1")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
  });

  it("shows (none) for active_deployment_id when null", () => {
    const agent = { ...fakeAgent, active_deployment_id: null };
    render(<AgentDetailPanel {...defaultProps} selectedAgent={agent} />);
    expect(screen.getByText("(none)")).toBeTruthy();
  });

  it("calls onCopyId when Copy ID clicked", async () => {
    render(<AgentDetailPanel {...defaultProps} selectedAgent={fakeAgent} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy ID" }));
    expect(defaultProps.onCopyId).toHaveBeenCalledTimes(1);
  });

  it("calls onRefreshDetails when Refresh details clicked", async () => {
    render(<AgentDetailPanel {...defaultProps} selectedAgent={fakeAgent} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh details" }));
    expect(defaultProps.onRefreshDetails).toHaveBeenCalledTimes(1);
  });

  it("calls onDelete when Delete agent clicked", async () => {
    render(<AgentDetailPanel {...defaultProps} selectedAgent={fakeAgent} />);
    await userEvent.click(screen.getByRole("button", { name: /Delete agent/ }));
    expect(defaultProps.onDelete).toHaveBeenCalledTimes(1);
  });

  it("disables delete button when canUseApi is false", () => {
    render(
      <AgentDetailPanel {...defaultProps} selectedAgent={fakeAgent} canUseApi={false} />,
    );
    expect(screen.getByRole("button", { name: /Delete agent/ })).toBeDisabled();
  });

  it("shows 'Deleting…' during delete loading", () => {
    render(
      <AgentDetailPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deleteStatus="loading"
      />,
    );
    expect(screen.getByText("Deleting…")).toBeTruthy();
    expect(screen.getByText("Deleting…")).toBeDisabled();
  });

  it("shows delete error message", () => {
    render(
      <AgentDetailPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deleteStatus="error"
        deleteError="Permission denied"
      />,
    );
    expect(screen.getByText("Permission denied")).toBeTruthy();
  });

  it("shows 'deleted' badge on success", () => {
    render(
      <AgentDetailPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        deleteStatus="success"
      />,
    );
    expect(screen.getByText("deleted")).toBeTruthy();
  });

  it("shows back button in detail view mode", () => {
    render(
      <AgentDetailPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        viewMode="detail"
      />,
    );
    // The back button text is "← Back" (using HTML entity &larr;)
    const backBtn = screen.getByRole("button", { name: /Back/ });
    expect(backBtn).toBeTruthy();
    expect(backBtn.style.display).not.toBe("none");
  });

  it("hides back button in combined view mode", () => {
    const { container } = render(
      <AgentDetailPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        viewMode="combined"
      />,
    );
    // Back button exists in DOM but is hidden via inline style display: none
    const backBtn = container.querySelector("button[title='Back to agents list']");
    expect(backBtn).toBeTruthy();
    expect((backBtn as HTMLElement).style.display).toBe("none");
  });

  it("calls onBackToList when back button clicked", async () => {
    render(
      <AgentDetailPanel
        {...defaultProps}
        selectedAgent={fakeAgent}
        viewMode="detail"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(defaultProps.onBackToList).toHaveBeenCalledTimes(1);
  });
});
