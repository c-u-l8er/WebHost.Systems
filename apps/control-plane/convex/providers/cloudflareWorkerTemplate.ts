/**
 * Cloudflare Worker template generator for webhost.systems v1 (Slice B)
 *
 * This file intentionally does NOT export a Worker implementation directly.
 * Instead it exports a string generator that produces the module source code
 * to upload to Cloudflare Workers via the provider adapter.
 *
 * The generated Worker implements:
 * - `invoke/v1` handling (text-first response)
 * - best-effort signed telemetry emission (deployment-scoped HMAC over raw telemetry body bytes)
 *
 * It expects the deploy pipeline to inject these env vars / secrets at deploy time:
 * - TELEMETRY_SECRET (secret binding; base64url-encoded key bytes, 32 bytes recommended)
 * - TELEMETRY_REPORT_URL (string; control-plane telemetry ingestion endpoint)
 * - USER_ID (string; internal control-plane user id)
 * - AGENT_ID (string)
 * - DEPLOYMENT_ID (string)
 * - RUNTIME_PROVIDER (string; should be "cloudflare")
 */

export type CloudflareWorkerTemplateOptions = {
  /**
   * The path your control plane will invoke on the Worker.
   * Must start with "/".
   *
   * Default: "/invoke"
   */
  invokePath?: string;

  /**
   * Soft cap for output size to keep responses bounded.
   * If set, this value is embedded as the default max output chars in the worker.
   *
   * Default: 8000
   */
  defaultMaxOutputChars?: number;

  /**
   * If true, the generated worker will reject ambiguous inputs where both
   * `input.prompt` and `input.messages` are provided.
   *
   * ADR-0006 notes you should pick a consistent policy; the recommended policy
   * in the spec is to reject ambiguity at the gateway. This option allows you
   * to keep the worker strict too.
   *
   * Default: false (prefer messages if both provided)
   */
  rejectAmbiguousInput?: boolean;
};

export function renderCloudflareWorkerTemplate(
  options: CloudflareWorkerTemplateOptions = {},
): string {
  const invokePath = normalizeInvokePath(options.invokePath ?? "/invoke");
  const defaultMaxOutputChars =
    normalizePositiveInt(options.defaultMaxOutputChars) ?? 8000;
  const rejectAmbiguousInput = options.rejectAmbiguousInput ?? false;

  // Generate the module code as a string (ESM).
  // Note: we embed only safe compile-time constants here.
  return `/**
 * Generated Cloudflare Worker module for webhost.systems v1 (Slice B)
 *
 * Implements:
 * - invoke/v1 request handling (text-first)
 * - signed telemetry emission (deployment-scoped HMAC over raw telemetry body bytes)
 *
 * Invocation path:
 * - ${invokePath}
 *
 * Expected injected env vars/secrets:
 * - TELEMETRY_SECRET (secret; base64url of raw key bytes, 32 bytes recommended)
 * - TELEMETRY_REPORT_URL (string; e.g. https://<your-convex-host>/v1/telemetry/report)
 * - USER_ID (string; internal control-plane user id)
 * - AGENT_ID (string)
 * - DEPLOYMENT_ID (string)
 * - RUNTIME_PROVIDER (string; should be "cloudflare")
 *
 * Notes:
 * - This template does not implement Durable Objects session state.
 *   It returns an opaque sessionId and treats it as opaque input/output only.
 * - Telemetry emission is best-effort and happens via ctx.waitUntil(...) so it
 *   does not block invocation responses.
 */

const INVOKE_PATH = ${JSON.stringify(invokePath)};
const DEFAULT_MAX_OUTPUT_CHARS = ${JSON.stringify(defaultMaxOutputChars)};
const REJECT_AMBIGUOUS_INPUT = ${JSON.stringify(rejectAmbiguousInput)};

export interface Env {
  // Secret binding injected by the deploy pipeline:
  // base64url of raw key bytes (32 bytes recommended).
  TELEMETRY_SECRET?: string;

  // Control-plane telemetry ingestion endpoint.
  TELEMETRY_REPORT_URL?: string;

  // Attribution fields (injected by deploy pipeline).
  USER_ID?: string;
  AGENT_ID?: string;
  DEPLOYMENT_ID?: string;
  RUNTIME_PROVIDER?: string;

  // Optional: allow simple per-deployment tuning.
  // If provided and valid, overrides DEFAULT_MAX_OUTPUT_CHARS.
  MAX_OUTPUT_CHARS?: string; // numeric string
}

type InvokeV1MessageRole = "system" | "user" | "assistant" | "tool";

type InvokeV1Message = {
  role: InvokeV1MessageRole;
  content: string;
};

type InvokeV1Request = {
  protocol?: "invoke/v1";
  traceId?: string;
  sessionId?: string;
  input?: {
    prompt?: string;
    messages?: InvokeV1Message[];
  };
};

type InvokeV1Response = {
  protocol: "invoke/v1";
  traceId: string;
  sessionId?: string;
  output: {
    text: string;
  };
  usage?: {
    tokens?: number;
    computeMs?: number;
  };
};

type TelemetryEventV1 = {
  // Required attribution
  userId: string;
  agentId: string;
  deploymentId: string;
  runtimeProvider: "cloudflare" | "agentcore";

  // Event metadata
  timestampMs: number;
  requests: number;

  // Metering
  llmTokens: number;
  computeMs: number;
  costUsdEstimated: number;

  // Observability
  errors: number;
  errorClass?: "auth" | "limit" | "runtime" | "tool" | "unknown";
  traceId?: string;

  // Optional runtime-specific fields
  provider?: Record<string, unknown>;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== INVOKE_PATH) {
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Not found",
          },
        },
        { status: 404 },
      );
    }

    if (request.method !== "POST") {
      return json(
        {
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Method not allowed",
          },
        },
        { status: 405, headers: { allow: "POST" } },
      );
    }

    const startMs = Date.now();

    // Parse request JSON. (Invocation request bytes are not used for telemetry signature.)
    let invokeReq: InvokeV1Request;
    try {
      invokeReq = (await request.json()) as InvokeV1Request;
    } catch {
      return json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid JSON",
          },
        },
        { status: 400 },
      );
    }

    const traceId = invokeReq.traceId ?? \`trace_\${crypto.randomUUID()}\`;
    const sessionId = invokeReq.sessionId ?? \`sess_\${crypto.randomUUID()}\`;

    let messages: InvokeV1Message[];
    try {
      messages = normalizeMessages(invokeReq);
    } catch (e) {
      return json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: e instanceof Error ? e.message : "Invalid request",
          },
        },
        { status: 400 },
      );
    }

    // Minimal deterministic “agent” behavior for Slice B: echo the latest user message.
    const lastUser =
      [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const responseTextRaw = lastUser
      ? \`You said: \${lastUser}\`
      : "No user message provided.";

    const maxChars =
      parseOptionalPositiveInt(env.MAX_OUTPUT_CHARS) ?? DEFAULT_MAX_OUTPUT_CHARS;

    const responseText =
      responseTextRaw.length > maxChars
        ? responseTextRaw.slice(0, maxChars)
        : responseTextRaw;

    const computeMs = Math.max(0, Date.now() - startMs);

    // Token estimate is intentionally rough for the template.
    const tokensEstimated = estimateTokensFromText(messages, responseText);

    const resp: InvokeV1Response = {
      protocol: "invoke/v1",
      traceId,
      sessionId,
      output: {
        text: responseText,
      },
      usage: {
        tokens: tokensEstimated,
        computeMs,
      },
    };

    // Best-effort telemetry emission (non-blocking)
    ctx.waitUntil(
      emitTelemetry({
        env,
        traceId,
        computeMs,
        llmTokens: tokensEstimated,
        errors: 0,
        errorClass: undefined,
        providerMeta: {
          worker: {
            pathname: url.pathname,
          },
        },
      }),
    );

    return json(resp, { status: 200 });
  },
};

function normalizeMessages(req: InvokeV1Request): InvokeV1Message[] {
  const input = req.input ?? {};
  const hasMessages = Array.isArray(input.messages) && input.messages.length > 0;
  const hasPrompt = typeof input.prompt === "string" && input.prompt.length > 0;

  if (hasMessages && hasPrompt) {
    if (REJECT_AMBIGUOUS_INPUT) {
      throw new Error("Provide either input.messages or input.prompt, not both");
    }
    // Deterministic fallback: prefer messages
    return sanitizeMessages(input.messages!);
  }

  if (hasMessages) {
    return sanitizeMessages(input.messages!);
  }

  if (hasPrompt) {
    return [{ role: "user", content: input.prompt! }];
  }

  return [];
}

function sanitizeMessages(messages: InvokeV1Message[]): InvokeV1Message[] {
  return messages
    .filter((m) => m && typeof m.role === "string" && typeof m.content === "string")
    .map((m) => ({
      role: m.role as InvokeV1MessageRole,
      content: m.content,
    }));
}

function estimateTokensFromText(messages: InvokeV1Message[], outputText: string): number {
  // Rough heuristic: ~4 chars/token average for English.
  const inputChars = messages.reduce((acc, m) => acc + m.content.length, 0);
  const outputChars = outputText.length;
  const approx = Math.ceil((inputChars + outputChars) / 4);
  return Math.max(1, approx);
}

async function emitTelemetry(args: {
  env: Env;
  traceId: string;
  computeMs: number;
  llmTokens: number;
  errors: number;
  errorClass?: TelemetryEventV1["errorClass"];
  providerMeta?: Record<string, unknown>;
}): Promise<void> {
  const { env, traceId, computeMs, llmTokens, errors, errorClass, providerMeta } = args;

  // Required env vars for attribution + auth
  const reportUrl = env.TELEMETRY_REPORT_URL;
  const secretB64u = env.TELEMETRY_SECRET;

  const userId = env.USER_ID;
  const agentId = env.AGENT_ID;
  const deploymentId = env.DEPLOYMENT_ID;
  const runtimeProvider = (env.RUNTIME_PROVIDER ?? "cloudflare") as TelemetryEventV1["runtimeProvider"];

  if (!reportUrl || !secretB64u || !userId || !agentId || !deploymentId) {
    // Missing config; skip telemetry. (Do not throw; do not block invocations.)
    return;
  }

  const event: TelemetryEventV1 = {
    userId,
    agentId,
    deploymentId,
    runtimeProvider,
    timestampMs: Date.now(),
    requests: 1,
    llmTokens,
    computeMs,
    errors,
    errorClass,
    costUsdEstimated: 0, // v1 placeholder; control plane can override with deterministic estimator if desired
    traceId,
    provider: providerMeta,
  };

  const bodyBytes = new TextEncoder().encode(JSON.stringify(event));
  const signatureHex = await hmacSha256HexFromBase64UrlKey(secretB64u, bodyBytes);

  // Telemetry auth headers (ADR-0004)
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "x-telemetry-deployment-id": deploymentId,
    "x-telemetry-signature": \`v1=\${signatureHex}\`,
  };

  // Best-effort POST; ignore failures.
  try {
    await fetch(reportUrl, {
      method: "POST",
      headers,
      body: bodyBytes,
    });
  } catch {
    // swallow
  }
}

async function hmacSha256HexFromBase64UrlKey(keyB64u: string, data: Uint8Array): Promise<string> {
  const keyBytes = base64UrlToBytes(keyB64u);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
  return bytesToHex(new Uint8Array(sig));
}

function base64UrlToBytes(b64url: string): Uint8Array {
  // Convert base64url -> base64
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function parseOptionalPositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function json(body: unknown, init?: { status?: number; headers?: Record<string, string> }): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers });
}
`;
}

function normalizeInvokePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/invoke";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizePositiveInt(n: number | undefined): number | null {
  if (n === undefined) return null;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}
