import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import AgentsListPanel from "./AgentsListPanel";

const makeAgent = (overrides: Record<string, any> = {}) => ({
  id: "a1",
  name: "alpha-agent",
  description: "First agent",
  workspace_id: "ws-1",
  created_by: "user-1",
  framework: null,
  status: "active" as const,
  runtime_provider: "openrouter" as const,
  env_var_keys: [],
  provider_config: {},
  system_prompt: null,
  model: null,
  active_deployment_id: "d1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-03-01T00:00:00Z",
  deleted_at: null,
  last_deployed_at: null,
  last_invocation_at: null,
  ...overrides,
});

const agentsList = [
  makeAgent({ id: "a1", name: "alpha-agent", status: "active", updated_at: "2026-03-01T00:00:00Z" }),
  makeAgent({ id: "a2", name: "beta-agent", status: "created", runtime_provider: "cloudflare", active_deployment_id: null, updated_at: "2026-02-01T00:00:00Z" }),
  makeAgent({ id: "a3", name: "gamma-agent", status: "disabled", updated_at: "2026-01-01T00:00:00Z" }),
];

describe("AgentsListPanel", () => {
  const defaultProps = {
    agents: agentsList,
    selectedAgentId: "",
    canUseApi: true,
    viewMode: "combined" as const,
    onSelectAgent: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    createStatus: "idle" as const,
    createError: null as string | null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows agent count in header", () => {
    render(<AgentsListPanel {...defaultProps} />);
    expect(screen.getByText("3 total")).toBeTruthy();
  });

  it("shows 'No agents yet' when list is empty", () => {
    render(<AgentsListPanel {...defaultProps} agents={[]} />);
    expect(screen.getByText("No agents yet. Create one below.")).toBeTruthy();
  });

  it("renders all agents in the table", () => {
    render(<AgentsListPanel {...defaultProps} />);
    expect(screen.getByText("alpha-agent")).toBeTruthy();
    expect(screen.getByText("beta-agent")).toBeTruthy();
    expect(screen.getByText("gamma-agent")).toBeTruthy();
  });

  it("calls onSelectAgent when agent row clicked", async () => {
    render(<AgentsListPanel {...defaultProps} />);
    await userEvent.click(screen.getByText("beta-agent"));
    expect(defaultProps.onSelectAgent).toHaveBeenCalledWith("a2");
  });

  it("highlights selected agent with primary button class", () => {
    render(<AgentsListPanel {...defaultProps} selectedAgentId="a1" />);
    const btn = screen.getByText("alpha-agent").closest("button");
    expect(btn?.className).toContain("button-primary");
  });

  // --- Search ---
  it("filters agents by search query", async () => {
    render(<AgentsListPanel {...defaultProps} />);
    const searchInput = screen.getByPlaceholderText(/Search/);
    await userEvent.type(searchInput, "beta");

    expect(screen.getByText("beta-agent")).toBeTruthy();
    expect(screen.queryByText("alpha-agent")).toBeNull();
    expect(screen.queryByText("gamma-agent")).toBeNull();
  });

  it("shows 'No agents match' when search matches nothing", async () => {
    render(<AgentsListPanel {...defaultProps} />);
    await userEvent.type(screen.getByPlaceholderText(/Search/), "zzzzz");
    expect(screen.getByText("No agents match your filters.")).toBeTruthy();
  });

  // --- Filters ---
  it("filters by status", async () => {
    render(<AgentsListPanel {...defaultProps} />);
    const statusSelect = screen.getByLabelText("Filter by status");
    await userEvent.selectOptions(statusSelect, "disabled");

    expect(screen.getByText("gamma-agent")).toBeTruthy();
    expect(screen.queryByText("alpha-agent")).toBeNull();
  });

  it("filters by runtime", async () => {
    render(<AgentsListPanel {...defaultProps} />);
    const runtimeSelect = screen.getByLabelText("Filter by runtime");
    await userEvent.selectOptions(runtimeSelect, "cloudflare");

    expect(screen.getByText("beta-agent")).toBeTruthy();
    expect(screen.queryByText("alpha-agent")).toBeNull();
  });

  it("filters by deployment presence", async () => {
    render(<AgentsListPanel {...defaultProps} />);
    const depSelect = screen.getByLabelText("Filter by active deployment");
    await userEvent.selectOptions(depSelect, "none");

    expect(screen.getByText("beta-agent")).toBeTruthy();
    expect(screen.queryByText("alpha-agent")).toBeNull();
  });

  // --- Sorting ---
  it("sorts by name when Name header clicked", async () => {
    render(<AgentsListPanel {...defaultProps} />);
    const table = screen.getByRole("table", { name: "Agents table" });
    const nameHeader = within(table).getByText(/^Name/);
    await userEvent.click(nameHeader);

    // Name sort is ascending by default
    const rows = within(table).getAllByRole("row");
    // rows[0] is the header, data starts at rows[1]
    const firstDataCell = rows[1]?.textContent ?? "";
    expect(firstDataCell).toContain("alpha-agent");
  });

  // --- Reset ---
  it("resets all filters when Reset clicked", async () => {
    render(<AgentsListPanel {...defaultProps} />);

    // Apply a filter first
    const statusSelect = screen.getByLabelText("Filter by status");
    await userEvent.selectOptions(statusSelect, "disabled");
    expect(screen.queryByText("alpha-agent")).toBeNull();

    // Reset
    await userEvent.click(screen.getByRole("button", { name: /Reset/ }));

    // All agents should be visible again
    expect(screen.getByText("alpha-agent")).toBeTruthy();
    expect(screen.getByText("beta-agent")).toBeTruthy();
    expect(screen.getByText("gamma-agent")).toBeTruthy();
  });

  // --- Create agent ---
  it("calls onCreate with form values", async () => {
    render(<AgentsListPanel {...defaultProps} />);

    // The create button
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(defaultProps.onCreate).toHaveBeenCalledWith({
      name: "demo-agent", // default value
      description: "",
      systemPrompt: "",
      model: "anthropic/claude-sonnet-4-20250514",
    });
  });

  it("shows 'Creating…' during creation", () => {
    render(<AgentsListPanel {...defaultProps} createStatus="loading" />);
    expect(screen.getByText("Creating…")).toBeTruthy();
    expect(screen.getByText("Creating…")).toBeDisabled();
  });

  it("shows create error message", () => {
    render(
      <AgentsListPanel
        {...defaultProps}
        createStatus="error"
        createError="Name already exists"
      />,
    );
    expect(screen.getByText("Name already exists")).toBeTruthy();
  });

  it("disables controls when canUseApi is false", () => {
    render(<AgentsListPanel {...defaultProps} canUseApi={false} />);
    expect(screen.getByPlaceholderText(/Search/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  // --- Shown count badge ---
  it("shows correct count of visible agents", async () => {
    render(<AgentsListPanel {...defaultProps} />);
    expect(screen.getByText("3")).toBeTruthy(); // "shown 3"

    // Filter to only one
    await userEvent.selectOptions(
      screen.getByLabelText("Filter by status"),
      "active",
    );
    expect(screen.getByText("1")).toBeTruthy(); // "shown 1"
  });
});
