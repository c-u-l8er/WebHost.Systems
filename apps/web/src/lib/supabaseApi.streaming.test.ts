/**
 * Tests for invokeStream() and the internal parseSseStream() logic.
 *
 * These test the SSE streaming pathway that is NOT covered by supabaseApi.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock supabase client ----
const mockGetSession = vi.fn();
vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: (...args: any[]) => mockGetSession(...args),
    },
  },
}));

// Mock import.meta.env
vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");

import { invokeStream, ApiError } from "./supabaseApi";

// ---- Helpers ----

/** Create a ReadableStream from SSE text */
function sseStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

/** Create a ReadableStream that delivers chunks one at a time */
function chunkedSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

/** Collect all events from an async generator */
async function collectEvents(
  gen: AsyncGenerator<any, void, void>,
): Promise<any[]> {
  const events: any[] = [];
  for await (const evt of gen) {
    events.push(evt);
  }
  return events;
}

describe("invokeStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "test-token" } },
    });
  });

  it("throws 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    const gen = invokeStream("a1", {
      protocol: "invoke/v1",
      input: { prompt: "hi" },
    });

    await expect(collectEvents(gen)).rejects.toThrow(ApiError);

    try {
      mockGetSession.mockResolvedValue({ data: { session: null } });
      const gen2 = invokeStream("a1", {
        protocol: "invoke/v1",
        input: { prompt: "hi" },
      });
      await collectEvents(gen2);
    } catch (e: any) {
      expect(e.status).toBe(401);
      expect(e.code).toBe("UNAUTHORIZED");
    }
  });

  it("throws on non-OK response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });
    vi.stubGlobal("fetch", mockFetch);

    const gen = invokeStream("a1", {
      protocol: "invoke/v1",
      input: { prompt: "hi" },
    });

    await expect(collectEvents(gen)).rejects.toThrow(ApiError);

    try {
      vi.stubGlobal("fetch", mockFetch);
      const gen2 = invokeStream("a1", {
        protocol: "invoke/v1",
        input: { prompt: "hi" },
      });
      await collectEvents(gen2);
    } catch (e: any) {
      expect(e.status).toBe(500);
      expect(e.retryable).toBe(true);
    }

    vi.unstubAllGlobals();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  });

  it("throws on response with no body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    });
    vi.stubGlobal("fetch", mockFetch);

    const gen = invokeStream("a1", {
      protocol: "invoke/v1",
      input: { prompt: "hi" },
    });

    await expect(collectEvents(gen)).rejects.toThrow("SSE response missing body");

    vi.unstubAllGlobals();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  });

  it("parses single SSE event correctly", async () => {
    const body = sseStream(
      "event: meta\ndata: {\"model\":\"claude\"}\n\n",
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
    });
    vi.stubGlobal("fetch", mockFetch);

    const events = await collectEvents(
      invokeStream("a1", { protocol: "invoke/v1", input: { prompt: "hi" } }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("meta");
    expect(events[0].data).toEqual({ model: "claude" });

    vi.unstubAllGlobals();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  });

  it("parses multiple SSE events", async () => {
    const body = sseStream(
      [
        "event: meta\ndata: {\"model\":\"claude\"}\n\n",
        "event: delta\ndata: {\"text\":\"Hello\"}\n\n",
        "event: delta\ndata: {\"text\":\" world\"}\n\n",
        "event: usage\ndata: {\"prompt_tokens\":5,\"completion_tokens\":2}\n\n",
      ].join(""),
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
    });
    vi.stubGlobal("fetch", mockFetch);

    const events = await collectEvents(
      invokeStream("a1", { protocol: "invoke/v1", input: { prompt: "hi" } }),
    );

    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({ event: "meta", data: { model: "claude" } });
    expect(events[1]).toEqual({ event: "delta", data: { text: "Hello" } });
    expect(events[2]).toEqual({ event: "delta", data: { text: " world" } });
    expect(events[3]).toEqual({
      event: "usage",
      data: { prompt_tokens: 5, completion_tokens: 2 },
    });

    vi.unstubAllGlobals();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  });

  it("handles chunked delivery across frame boundaries", async () => {
    // Split SSE frames across chunks to test buffering
    const body = chunkedSseStream([
      "event: delta\nda",
      "ta: {\"text\":\"He",
      "llo\"}\n\nevent: delta\ndata: {\"text\":\" world\"}\n\n",
    ]);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
    });
    vi.stubGlobal("fetch", mockFetch);

    const events = await collectEvents(
      invokeStream("a1", { protocol: "invoke/v1", input: { prompt: "hi" } }),
    );

    expect(events).toHaveLength(2);
    expect(events[0].data).toEqual({ text: "Hello" });
    expect(events[1].data).toEqual({ text: " world" });

    vi.unstubAllGlobals();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  });

  it("defaults event name to 'message' when event: line is missing", async () => {
    const body = sseStream("data: {\"text\":\"no event line\"}\n\n");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
    });
    vi.stubGlobal("fetch", mockFetch);

    const events = await collectEvents(
      invokeStream("a1", { protocol: "invoke/v1", input: { prompt: "hi" } }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message");
    expect(events[0].data).toEqual({ text: "no event line" });

    vi.unstubAllGlobals();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  });

  it("handles non-JSON data gracefully", async () => {
    const body = sseStream("event: info\ndata: plain text here\n\n");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
    });
    vi.stubGlobal("fetch", mockFetch);

    const events = await collectEvents(
      invokeStream("a1", { protocol: "invoke/v1", input: { prompt: "hi" } }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("info");
    expect(events[0].data).toBe("plain text here");

    vi.unstubAllGlobals();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  });

  it("sends correct headers and body", async () => {
    const body = sseStream("event: done\ndata: {}\n\n");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
    });
    vi.stubGlobal("fetch", mockFetch);

    await collectEvents(
      invokeStream("a1", {
        protocol: "invoke/v1",
        input: { prompt: "test" },
        sessionId: "sess_1",
      }),
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.supabase.co/functions/v1/webhost-invoke",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify({
          agentId: "a1",
          protocol: "invoke/v1",
          input: { prompt: "test" },
          sessionId: "sess_1",
          stream: true,
        }),
      }),
    );

    vi.unstubAllGlobals();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  });

  it("passes abort signal through to fetch", async () => {
    const body = sseStream("event: done\ndata: {}\n\n");
    const controller = new AbortController();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
    });
    vi.stubGlobal("fetch", mockFetch);

    await collectEvents(
      invokeStream(
        "a1",
        { protocol: "invoke/v1", input: { prompt: "hi" } },
        { signal: controller.signal },
      ),
    );

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );

    vi.unstubAllGlobals();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  });

  it("handles multiline data fields", async () => {
    const body = sseStream(
      "event: delta\ndata: line1\ndata: line2\ndata: line3\n\n",
    );

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body,
    });
    vi.stubGlobal("fetch", mockFetch);

    const events = await collectEvents(
      invokeStream("a1", { protocol: "invoke/v1", input: { prompt: "hi" } }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("delta");
    // Multiple data lines joined with newlines
    expect(events[0].data).toBe("line1\nline2\nline3");

    vi.unstubAllGlobals();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  });
});
