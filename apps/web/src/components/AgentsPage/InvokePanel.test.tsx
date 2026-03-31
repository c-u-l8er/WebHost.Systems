import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// ---- API mocks ----
const mockInvoke = vi.fn();
const mockInvokeStream = vi.fn();

vi.mock("../../lib/supabaseApi", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
  invokeStream: (...args: any[]) => mockInvokeStream(...args),
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status;
      this.code = opts.code;
    }
  },
}));

import InvokePanel from "./InvokePanel";

const fakeAgent = {
  id: "a1",
  name: "test-agent",
  description: "desc",
  workspace_id: "ws-1",
  status: "active",
  runtime_provider: "openrouter" as const,
  env_var_keys: [],
  system_prompt: "You are helpful",
  model: "anthropic/claude-sonnet-4-20250514",
  active_deployment_id: "d1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
};

/** Helper: get the "Invoke" button (not the header <strong>) */
function getInvokeButton() {
  return screen.getByRole("button", { name: "Invoke" });
}

/** Helper: get the "Invoke (SSE)" button */
function getSseButton() {
  return screen.getByRole("button", { name: "Invoke (SSE)" });
}

describe("InvokePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows placeholder when no agent selected", () => {
    render(<InvokePanel selectedAgent={null} canUseApi={true} />);
    expect(screen.getByText("Select an agent to invoke.")).toBeTruthy();
  });

  it("renders prompt input and invoke buttons when agent selected", () => {
    render(<InvokePanel selectedAgent={fakeAgent} canUseApi={true} />);
    expect(getInvokeButton()).toBeTruthy();
    expect(getSseButton()).toBeTruthy();
    expect(screen.getByPlaceholderText("hello")).toBeTruthy();
  });

  it("disables inputs and buttons when canUseApi is false", () => {
    render(<InvokePanel selectedAgent={fakeAgent} canUseApi={false} />);
    expect(getInvokeButton()).toBeDisabled();
    expect(getSseButton()).toBeDisabled();
  });

  it("calls invoke API and shows response on success", async () => {
    const fakeResp = {
      protocol: "invoke/v1",
      traceId: "t1",
      output: { text: "Hello world!" },
      sessionId: "sess_123",
    };
    mockInvoke.mockResolvedValue(fakeResp);

    render(<InvokePanel selectedAgent={fakeAgent} canUseApi={true} />);

    await userEvent.click(getInvokeButton());

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("a1", {
        protocol: "invoke/v1",
        input: { prompt: "hello" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Non-streaming response")).toBeTruthy();
    });
  });

  it("shows error message on invoke failure", async () => {
    mockInvoke.mockRejectedValue(new Error("Network error"));

    render(<InvokePanel selectedAgent={fakeAgent} canUseApi={true} />);
    await userEvent.click(getInvokeButton());

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeTruthy();
    });
  });

  it("allows custom prompt input", async () => {
    mockInvoke.mockResolvedValue({
      protocol: "invoke/v1",
      output: { text: "response" },
    });

    render(<InvokePanel selectedAgent={fakeAgent} canUseApi={true} />);

    const textarea = screen.getByPlaceholderText("hello");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "custom prompt");
    await userEvent.click(getInvokeButton());

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("a1", {
        protocol: "invoke/v1",
        input: { prompt: "custom prompt" },
      });
    });
  });

  it("includes sessionId when provided", async () => {
    mockInvoke.mockResolvedValue({
      protocol: "invoke/v1",
      output: { text: "ok" },
    });

    render(<InvokePanel selectedAgent={fakeAgent} canUseApi={true} />);

    const sessionInput = screen.getByPlaceholderText("sess_...");
    await userEvent.type(sessionInput, "sess_abc");
    await userEvent.click(getInvokeButton());

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("a1", {
        protocol: "invoke/v1",
        input: { prompt: "hello" },
        sessionId: "sess_abc",
      });
    });
  });

  it("shows streaming section with SSE invoke", async () => {
    // Create an async generator that yields events
    async function* fakeStream() {
      yield { event: "meta", data: { model: "claude" } };
      yield { event: "delta", data: { text: "Hello" } };
      yield { event: "delta", data: { text: " world" } };
      yield { event: "usage", data: { prompt_tokens: 5, completion_tokens: 2 } };
    }
    mockInvokeStream.mockReturnValue(fakeStream());

    render(<InvokePanel selectedAgent={fakeAgent} canUseApi={true} />);
    await userEvent.click(getSseButton());

    await waitFor(() => {
      expect(screen.getByText("Stream")).toBeTruthy();
    });
  });
});
