import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mocks are available when vi.mock factory runs
const { mockSchema, mockFrom, mockRpc, mockFunctionsInvoke, makeQueryChain } = vi.hoisted(() => {
  const _mockRpc = vi.fn();
  const _mockFunctionsInvoke = vi.fn();

  function _makeQueryChain() {
    const chain: Record<string, any> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.gte = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    Object.defineProperty(chain, "then", {
      get() {
        return (resolve: any) => resolve({ data: [], error: null });
      },
      configurable: true,
    });
    return chain;
  }

  const _initialChain = _makeQueryChain();
  const _mockFrom = vi.fn().mockReturnValue(_initialChain);
  const _mockSchema = vi.fn().mockReturnValue({ from: _mockFrom });

  return {
    mockSchema: _mockSchema,
    mockFrom: _mockFrom,
    mockRpc: _mockRpc,
    mockFunctionsInvoke: _mockFunctionsInvoke,
    makeQueryChain: _makeQueryChain,
  };
});

let queryChain = makeQueryChain();

vi.mock("./supabaseClient", () => ({
  supabase: {
    schema: mockSchema,
    rpc: mockRpc,
    functions: { invoke: mockFunctionsInvoke },
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "test-token" } },
      }),
    },
  },
}));

import {
  ApiError,
  listAgents,
  getAgent,
  listDeployments,
  listRecentMetrics,
  getBillingUsage,
  createAgent,
  updateAgent,
  disableAgent,
  deleteAgent,
  deployAgent,
  activateDeployment,
  invoke,
} from "./supabaseApi";

describe("ApiError", () => {
  it("constructs with all fields", () => {
    const err = new ApiError({
      status: 404,
      code: "NOT_FOUND",
      message: "Agent not found",
      details: { id: "123" },
      retryable: false,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Agent not found");
    expect(err.details).toEqual({ id: "123" });
    expect(err.retryable).toBe(false);
  });

  it("works without optional fields", () => {
    const err = new ApiError({ status: 500, code: "ERR", message: "fail" });
    expect(err.details).toBeUndefined();
    expect(err.retryable).toBeUndefined();
  });
});

describe("PostgREST reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryChain = makeQueryChain();
    mockFrom.mockReturnValue(queryChain);
    mockSchema.mockReturnValue({ from: mockFrom });
  });

  describe("listAgents", () => {
    it("queries with workspace_id and filters deleted", async () => {
      const fakeAgents = [{ id: "a1", name: "test-agent" }];
      Object.defineProperty(queryChain, "then", {
        get() {
          return (resolve: any) => resolve({ data: fakeAgents, error: null });
        },
        configurable: true,
      });

      const result = await listAgents("ws-1", { limit: 10 });

      expect(mockSchema).toHaveBeenCalledWith("webhost");
      expect(mockFrom).toHaveBeenCalledWith("agents");
      expect(queryChain.select).toHaveBeenCalledWith("*");
      expect(queryChain.eq).toHaveBeenCalledWith("workspace_id", "ws-1");
      expect(queryChain.is).toHaveBeenCalledWith("deleted_at", null);
      expect(queryChain.limit).toHaveBeenCalledWith(10);
      expect(result).toEqual(fakeAgents);
    });

    it("includes deleted when requested", async () => {
      Object.defineProperty(queryChain, "then", {
        get() {
          return (resolve: any) => resolve({ data: [], error: null });
        },
        configurable: true,
      });

      await listAgents("ws-1", { includeDeleted: true });
      expect(queryChain.is).not.toHaveBeenCalled();
    });

    it("throws ApiError on database error", async () => {
      Object.defineProperty(queryChain, "then", {
        get() {
          return (resolve: any) =>
            resolve({
              data: null,
              error: { code: "42P01", message: "relation does not exist" },
            });
        },
        configurable: true,
      });

      await expect(listAgents("ws-1")).rejects.toThrow(ApiError);
    });
  });

  describe("getAgent", () => {
    it("queries single agent by id", async () => {
      const fakeAgent = { id: "a1", name: "test" };
      queryChain.single = vi.fn().mockResolvedValue({ data: fakeAgent, error: null });

      const result = await getAgent("a1");

      expect(queryChain.eq).toHaveBeenCalledWith("id", "a1");
      expect(queryChain.single).toHaveBeenCalled();
      expect(result).toEqual(fakeAgent);
    });

    it("throws 404 on PGRST116", async () => {
      queryChain.single = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "PGRST116", message: "not found" },
      });

      await expect(getAgent("missing")).rejects.toThrow(ApiError);
      try {
        await getAgent("missing");
      } catch (e) {
        expect((e as ApiError).status).toBe(404);
      }
    });
  });

  describe("listDeployments", () => {
    it("queries by agent_id", async () => {
      Object.defineProperty(queryChain, "then", {
        get() {
          return (resolve: any) => resolve({ data: [], error: null });
        },
        configurable: true,
      });

      await listDeployments("agent-1", { limit: 5 });

      expect(mockFrom).toHaveBeenCalledWith("deployments");
      expect(queryChain.eq).toHaveBeenCalledWith("agent_id", "agent-1");
      expect(queryChain.limit).toHaveBeenCalledWith(5);
    });
  });

  describe("listRecentMetrics", () => {
    it("applies since filter", async () => {
      Object.defineProperty(queryChain, "then", {
        get() {
          return (resolve: any) => resolve({ data: [], error: null });
        },
        configurable: true,
      });

      const since = "2026-03-30T00:00:00Z";
      await listRecentMetrics("agent-1", { since, limit: 10 });

      expect(mockFrom).toHaveBeenCalledWith("metrics_events");
      expect(queryChain.gte).toHaveBeenCalledWith("timestamp", since);
    });
  });

  describe("getBillingUsage", () => {
    it("queries billing_usage with period key", async () => {
      const fakeUsage = { id: "bu-1", period_key: "2026-03" };
      queryChain.maybeSingle = vi.fn().mockResolvedValue({ data: fakeUsage, error: null });

      const result = await getBillingUsage("ws-1", "2026-03");

      expect(mockFrom).toHaveBeenCalledWith("billing_usage");
      expect(result).toEqual(fakeUsage);
    });

    it("returns null when no usage exists", async () => {
      queryChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

      const result = await getBillingUsage("ws-1", "2025-01");
      expect(result).toBeNull();
    });
  });
});

describe("RPC writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createAgent calls rpc with correct params", async () => {
    const fakeAgent = { id: "new-1", name: "my-agent" };
    mockRpc.mockResolvedValue({ data: fakeAgent, error: null });

    const result = await createAgent({
      workspace_id: "ws-1",
      name: "my-agent",
      description: "desc",
      runtime_provider: "openrouter",
      env_var_keys: ["KEY1"],
      system_prompt: "You are helpful",
      model: "anthropic/claude-sonnet-4-20250514",
    });

    expect(mockRpc).toHaveBeenCalledWith("create_agent", {
      p_workspace_id: "ws-1",
      p_name: "my-agent",
      p_description: "desc",
      p_runtime_provider: "openrouter",
      p_env_var_keys: ["KEY1"],
      p_system_prompt: "You are helpful",
      p_model: "anthropic/claude-sonnet-4-20250514",
    });
    expect(result).toEqual(fakeAgent);
  });

  it("createAgent defaults optional fields", async () => {
    mockRpc.mockResolvedValue({ data: { id: "x" }, error: null });

    await createAgent({ workspace_id: "ws-1", name: "bare" });

    expect(mockRpc).toHaveBeenCalledWith("create_agent", {
      p_workspace_id: "ws-1",
      p_name: "bare",
      p_description: null,
      p_runtime_provider: "openrouter",
      p_env_var_keys: [],
      p_system_prompt: null,
      p_model: null,
    });
  });

  it("createAgent throws on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "unique violation" },
    });

    await expect(
      createAgent({ workspace_id: "ws-1", name: "dup" }),
    ).rejects.toThrow(ApiError);
  });

  it("updateAgent calls rpc", async () => {
    mockRpc.mockResolvedValue({ data: { id: "a1" }, error: null });

    await updateAgent({ agent_id: "a1", name: "renamed" });

    expect(mockRpc).toHaveBeenCalledWith(
      "update_agent",
      expect.objectContaining({ p_agent_id: "a1", p_name: "renamed" }),
    );
  });

  it("disableAgent calls rpc", async () => {
    mockRpc.mockResolvedValue({ data: { id: "a1", status: "disabled" }, error: null });

    const result = await disableAgent("a1");
    expect(mockRpc).toHaveBeenCalledWith("disable_agent", { p_agent_id: "a1" });
    expect(result.status).toBe("disabled");
  });

  it("deleteAgent calls rpc", async () => {
    mockRpc.mockResolvedValue({ data: { id: "a1" }, error: null });

    await deleteAgent("a1");
    expect(mockRpc).toHaveBeenCalledWith("delete_agent", { p_agent_id: "a1" });
  });
});

describe("Edge Function calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deployAgent invokes webhost-deploy", async () => {
    const fakeDep = { id: "d1", version: 1 };
    mockFunctionsInvoke.mockResolvedValue({ data: fakeDep, error: null });

    const result = await deployAgent("agent-1", { invokePath: "/invoke" });

    expect(mockFunctionsInvoke).toHaveBeenCalledWith("webhost-deploy", {
      body: { agentId: "agent-1", invokePath: "/invoke" },
    });
    expect(result).toEqual(fakeDep);
  });

  it("deployAgent throws on error", async () => {
    mockFunctionsInvoke.mockResolvedValue({
      data: null,
      error: { name: "FunctionsHttpError", message: "deploy failed", context: { status: 500 } },
    });

    await expect(deployAgent("agent-1")).rejects.toThrow(ApiError);
  });

  it("activateDeployment invokes webhost-activate-deployment", async () => {
    const fakeAgent = { id: "a1", active_deployment_id: "d2" };
    mockFunctionsInvoke.mockResolvedValue({ data: fakeAgent, error: null });

    const result = await activateDeployment("a1", "d2", { reason: "test" });

    expect(mockFunctionsInvoke).toHaveBeenCalledWith("webhost-activate-deployment", {
      body: { agentId: "a1", deploymentId: "d2", reason: "test" },
    });
    expect(result).toEqual(fakeAgent);
  });

  it("invoke calls webhost-invoke", async () => {
    const fakeResp = { protocol: "invoke/v1", traceId: "t1", output: { text: "hello" } };
    mockFunctionsInvoke.mockResolvedValue({ data: fakeResp, error: null });

    const result = await invoke("a1", {
      protocol: "invoke/v1",
      input: { prompt: "hi" },
    });

    expect(mockFunctionsInvoke).toHaveBeenCalledWith("webhost-invoke", {
      body: { agentId: "a1", protocol: "invoke/v1", input: { prompt: "hi" } },
    });
    expect(result.output.text).toBe("hello");
  });
});
