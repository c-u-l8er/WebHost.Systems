import React, { useCallback, useRef, useState } from "react";
import {
  type InvokeV1Request,
  type SseEvent,
  invoke as apiInvoke,
  invokeStream as apiInvokeStream,
} from "../../lib/supabaseApi";
import type { Agent, AsyncStatus, InvokeV1Response } from "./types";
import { stringifyJson, summarizeError } from "./utils";

export type InvokePanelProps = {
  selectedAgent: Agent | null;
  canUseApi: boolean;
};

export default function InvokePanel({
  selectedAgent,
  canUseApi,
}: InvokePanelProps): React.ReactElement {
  const [invokePrompt, setInvokePrompt] = useState("hello");
  const [invokeSessionId, setInvokeSessionId] = useState("");
  const [invokeStatus, setInvokeStatus] = useState<AsyncStatus>("idle");
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const [invokeResponse, setInvokeResponse] = useState<InvokeV1Response | null>(null);
  const [invokeRaw, setInvokeRaw] = useState("");

  const [streamStatus, setStreamStatus] = useState<AsyncStatus>("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [streamMeta, setStreamMeta] = useState<any>(null);
  const [streamUsage, setStreamUsage] = useState<any>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const handleSseEvent = useCallback((evt: SseEvent) => {
    if (evt.event === "meta") {
      setStreamMeta(evt.data);
      return;
    }
    if (evt.event === "delta") {
      const deltaText =
        (evt.data && typeof (evt.data as any).text === "string" && (evt.data as any).text) ||
        (typeof evt.data === "string" ? evt.data : "");
      if (deltaText) setStreamText((prev) => prev + deltaText);
      return;
    }
    if (evt.event === "usage") {
      setStreamUsage(evt.data);
      return;
    }
    if (evt.event === "error") {
      setStreamError(stringifyJson(evt.data));
      setStreamStatus("error");
      return;
    }
  }, []);

  const invokeSelected = useCallback(async () => {
    if (!selectedAgent) return;

    setInvokeStatus("loading");
    setInvokeError(null);
    setInvokeResponse(null);
    setInvokeRaw("");

    try {
      const req: InvokeV1Request = { protocol: "invoke/v1", input: { prompt: invokePrompt } };
      const session = invokeSessionId.trim();
      if (session) req.sessionId = session;

      const resp = await apiInvoke(selectedAgent.id, req);
      setInvokeResponse(resp);
      setInvokeRaw(stringifyJson(resp));
      setInvokeStatus("success");
      if (resp.sessionId) setInvokeSessionId(resp.sessionId);
    } catch (err) {
      setInvokeStatus("error");
      setInvokeError(summarizeError(err));
    }
  }, [invokePrompt, invokeSessionId, selectedAgent]);

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setStreamStatus("idle");
  }, []);

  const invokeSelectedStream = useCallback(async () => {
    if (!selectedAgent) return;

    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;

    setStreamStatus("loading");
    setStreamError(null);
    setStreamText("");
    setStreamMeta(null);
    setStreamUsage(null);

    try {
      const req: InvokeV1Request = { protocol: "invoke/v1", input: { prompt: invokePrompt } };
      const session = invokeSessionId.trim();
      if (session) req.sessionId = session;

      for await (const evt of apiInvokeStream(selectedAgent.id, req, { signal: controller.signal })) {
        if (controller.signal.aborted) break;
        handleSseEvent(evt);
      }

      if (!controller.signal.aborted) setStreamStatus("success");
    } catch (err) {
      if (!controller.signal.aborted) {
        setStreamStatus("error");
        setStreamError(summarizeError(err));
      }
    } finally {
      if (!controller.signal.aborted) {
        streamAbortRef.current = null;
      }
    }
  }, [handleSseEvent, invokePrompt, invokeSessionId, selectedAgent]);

  return (
    <section className="panel" id="invoke">
      <div className="panel-header">
        <div className="row">
          <strong>Invoke</strong>
          <div className="spacer" />
          <span className="badge">
            <span className="muted">protocol</span> invoke/v1
          </span>
        </div>
      </div>

      <div className="panel-body">
        {!selectedAgent ? (
          <div className="muted">Select an agent to invoke.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ gridColumn: "span 2" }}>
                <div className="muted" style={{ fontSize: 12 }}>prompt</div>
                <textarea
                  className="button"
                  style={{ width: "100%", textAlign: "left", minHeight: 90, resize: "vertical", fontFamily: "var(--mono)" }}
                  value={invokePrompt}
                  onChange={(e) => setInvokePrompt(e.target.value)}
                  placeholder="hello"
                  disabled={!canUseApi || invokeStatus === "loading" || streamStatus === "loading"}
                />
              </div>

              <div>
                <div className="muted" style={{ fontSize: 12 }}>sessionId (optional, opaque)</div>
                <input
                  className="button"
                  style={{ width: "100%", textAlign: "left" }}
                  value={invokeSessionId}
                  onChange={(e) => setInvokeSessionId(e.target.value)}
                  placeholder="sess_..."
                  disabled={!canUseApi || invokeStatus === "loading" || streamStatus === "loading"}
                />
              </div>

              <div>
                <div className="muted" style={{ fontSize: 12 }}>streaming</div>
                <div className="row">
                  <button
                    className="button"
                    onClick={() => void invokeSelected()}
                    disabled={!canUseApi || invokeStatus === "loading" || streamStatus === "loading"}
                  >
                    {invokeStatus === "loading" ? "Invoking…" : "Invoke"}
                  </button>
                  <button
                    className="button"
                    onClick={() => void invokeSelectedStream()}
                    disabled={!canUseApi || streamStatus === "loading" || invokeStatus === "loading"}
                  >
                    {streamStatus === "loading" ? "Streaming…" : "Invoke (SSE)"}
                  </button>
                  {streamStatus === "loading" ? (
                    <button className="button" onClick={stopStreaming}>Stop</button>
                  ) : null}
                </div>
              </div>
            </div>

            {invokeError || streamError ? (
              <div style={{ marginTop: 10 }}>
                <div
                  className="badge"
                  style={{ borderColor: "rgba(255, 107, 107, 0.6)", background: "rgba(255, 107, 107, 0.08)" }}
                >
                  <span style={{ color: "var(--danger)" }}>error</span> {invokeError ?? streamError}
                </div>
              </div>
            ) : null}

            {invokeResponse ? (
              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Non-streaming response</div>
                <pre
                  style={{
                    margin: 0, marginTop: 6, padding: 10, border: "1px solid var(--border)",
                    borderRadius: 10, background: "rgba(0,0,0,0.25)", overflowX: "auto", maxHeight: 240,
                  }}
                >
                  {invokeRaw || stringifyJson(invokeResponse)}
                </pre>
              </div>
            ) : null}

            {streamStatus !== "idle" ? (
              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ fontSize: 12 }}>Stream</div>

                {streamMeta ? (
                  <pre
                    style={{
                      margin: 0, marginTop: 6, padding: 10, border: "1px solid var(--border)",
                      borderRadius: 10, background: "rgba(0,0,0,0.22)", overflowX: "auto", maxHeight: 180,
                    }}
                  >
                    {"[meta]\n" + stringifyJson(streamMeta)}
                  </pre>
                ) : null}

                <pre
                  style={{
                    margin: 0, marginTop: 6, padding: 10, border: "1px solid var(--border)",
                    borderRadius: 10, background: "rgba(0,0,0,0.25)", overflowX: "auto", maxHeight: 240, whiteSpace: "pre-wrap",
                  }}
                >
                  {streamText || "—"}
                </pre>

                {streamUsage ? (
                  <pre
                    style={{
                      margin: 0, marginTop: 6, padding: 10, border: "1px solid var(--border)",
                      borderRadius: 10, background: "rgba(0,0,0,0.22)", overflowX: "auto", maxHeight: 180,
                    }}
                  >
                    {"[usage]\n" + stringifyJson(streamUsage)}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
