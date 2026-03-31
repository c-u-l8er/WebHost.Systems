import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// ---- Auth mock (WorkspaceProvider depends on useSupabaseAuth) ----
const mockUser = { current: null as any };

vi.mock("./SupabaseAuthProvider", () => ({
  useSupabaseAuth: () => ({
    user: mockUser.current,
    session: mockUser.current ? { user: mockUser.current } : null,
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
  }),
}));

// ---- Supabase client mock ----
const mockRpc = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockFrom = vi.fn();
const mockSchema = vi.fn();

// Build the fluent chain
function makeQueryChain() {
  const chain: Record<string, any> = {};
  chain.select = mockSelect.mockReturnValue(chain);
  chain.eq = mockEq.mockReturnValue(chain);
  Object.defineProperty(chain, "then", {
    get() {
      return (resolve: any) => resolve({ data: [], error: null });
    },
    configurable: true,
  });
  return chain;
}

let queryChain = makeQueryChain();

vi.mock("./supabaseClient", () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    schema: (...args: any[]) => mockSchema(...args),
  },
}));

// Wire up schema → from → chain
beforeEach(() => {
  queryChain = makeQueryChain();
  mockFrom.mockReturnValue(queryChain);
  mockSchema.mockReturnValue({ from: mockFrom });
});

import { WorkspaceProvider, useWorkspace } from "./WorkspaceProvider";

// ---- localStorage mock ----
const localStorageData: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageData[key] ?? null),
  setItem: vi.fn((key: string, val: string) => {
    localStorageData[key] = val;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageData[key];
  }),
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Test consumer
function WsConsumer() {
  const { workspace, workspaces, loading, error, setActiveWorkspace, refresh } =
    useWorkspace();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <span data-testid="active-id">{workspace?.id ?? "none"}</span>
      <span data-testid="active-name">{workspace?.name ?? "none"}</span>
      <span data-testid="count">{workspaces.length}</span>
      <button data-testid="switch" onClick={() => setActiveWorkspace("ws-2")}>
        switch
      </button>
      <button data-testid="refresh" onClick={() => void refresh()}>
        refresh
      </button>
    </div>
  );
}

const fakeUser = { id: "user-1", email: "a@b.com" };

const fakeWorkspaces = [
  { id: "ws-1", name: "Personal", slug: "personal", plan: "free", created_at: "2026-01-01T00:00:00Z" },
  { id: "ws-2", name: "Team", slug: "team", plan: "pro", created_at: "2026-02-01T00:00:00Z" },
];

describe("WorkspaceProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = null;
    Object.keys(localStorageData).forEach((k) => delete localStorageData[k]);
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it("shows empty state when no user is logged in", async () => {
    mockUser.current = null;

    render(
      <WorkspaceProvider>
        <WsConsumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("active-id").textContent).toBe("none");
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("calls ensure_user_workspace RPC and loads workspaces", async () => {
    mockUser.current = fakeUser;
    mockRpc.mockResolvedValue({ data: null, error: null });

    // Return workspaces from the query
    Object.defineProperty(queryChain, "then", {
      get() {
        return (resolve: any) =>
          resolve({
            data: fakeWorkspaces.map((ws) => ({ workspace: ws })),
            error: null,
          });
      },
      configurable: true,
    });

    render(
      <WorkspaceProvider>
        <WsConsumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(mockRpc).toHaveBeenCalledWith("ensure_user_workspace");
    expect(mockSchema).toHaveBeenCalledWith("amp");
    expect(mockFrom).toHaveBeenCalledWith("workspace_members");
    expect(screen.getByTestId("count").textContent).toBe("2");
    expect(screen.getByTestId("active-id").textContent).toBe("ws-1");
  });

  it("restores active workspace from localStorage", async () => {
    mockUser.current = fakeUser;
    localStorageData["wh:activeWorkspaceId"] = "ws-2";

    Object.defineProperty(queryChain, "then", {
      get() {
        return (resolve: any) =>
          resolve({
            data: fakeWorkspaces.map((ws) => ({ workspace: ws })),
            error: null,
          });
      },
      configurable: true,
    });

    render(
      <WorkspaceProvider>
        <WsConsumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("active-id").textContent).toBe("ws-2");
    expect(screen.getByTestId("active-name").textContent).toBe("Team");
  });

  it("falls back to first workspace if stored ID not found", async () => {
    mockUser.current = fakeUser;
    localStorageData["wh:activeWorkspaceId"] = "ws-deleted";

    Object.defineProperty(queryChain, "then", {
      get() {
        return (resolve: any) =>
          resolve({
            data: fakeWorkspaces.map((ws) => ({ workspace: ws })),
            error: null,
          });
      },
      configurable: true,
    });

    render(
      <WorkspaceProvider>
        <WsConsumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("active-id").textContent).toBe("ws-1");
  });

  it("setActiveWorkspace updates state and localStorage", async () => {
    mockUser.current = fakeUser;

    Object.defineProperty(queryChain, "then", {
      get() {
        return (resolve: any) =>
          resolve({
            data: fakeWorkspaces.map((ws) => ({ workspace: ws })),
            error: null,
          });
      },
      configurable: true,
    });

    render(
      <WorkspaceProvider>
        <WsConsumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-id").textContent).toBe("ws-1");
    });

    await userEvent.click(screen.getByTestId("switch"));

    expect(screen.getByTestId("active-id").textContent).toBe("ws-2");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "wh:activeWorkspaceId",
      "ws-2",
    );
  });

  it("sets error when RPC fails", async () => {
    mockUser.current = fakeUser;
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "RPC timeout" },
    });

    render(
      <WorkspaceProvider>
        <WsConsumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("error").textContent).toBe("RPC timeout");
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("sets error when workspace query fails", async () => {
    mockUser.current = fakeUser;
    mockRpc.mockResolvedValue({ data: null, error: null });

    Object.defineProperty(queryChain, "then", {
      get() {
        return (resolve: any) =>
          resolve({
            data: null,
            error: { message: "permission denied" },
          });
      },
      configurable: true,
    });

    render(
      <WorkspaceProvider>
        <WsConsumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("error").textContent).toBe("permission denied");
  });

  it("refresh reloads workspaces", async () => {
    mockUser.current = fakeUser;

    Object.defineProperty(queryChain, "then", {
      get() {
        return (resolve: any) =>
          resolve({
            data: [{ workspace: fakeWorkspaces[0] }],
            error: null,
          });
      },
      configurable: true,
    });

    render(
      <WorkspaceProvider>
        <WsConsumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("1");
    });

    // Add a second workspace on refresh
    Object.defineProperty(queryChain, "then", {
      get() {
        return (resolve: any) =>
          resolve({
            data: fakeWorkspaces.map((ws) => ({ workspace: ws })),
            error: null,
          });
      },
      configurable: true,
    });

    await userEvent.click(screen.getByTestId("refresh"));

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("2");
    });
  });

  it("filters out null workspace entries from data", async () => {
    mockUser.current = fakeUser;

    Object.defineProperty(queryChain, "then", {
      get() {
        return (resolve: any) =>
          resolve({
            data: [
              { workspace: fakeWorkspaces[0] },
              { workspace: null },
              { workspace: fakeWorkspaces[1] },
            ],
            error: null,
          });
      },
      configurable: true,
    });

    render(
      <WorkspaceProvider>
        <WsConsumer />
      </WorkspaceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("2");
    });
  });
});

describe("useWorkspace", () => {
  it("throws when used outside provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Orphan() {
      useWorkspace();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(
      "useWorkspace must be used within a <WorkspaceProvider>",
    );

    spy.mockRestore();
  });
});
