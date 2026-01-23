import type { EncryptedSecretV1 } from "../lib/crypto";
import {
  encryptSecretV1,
  generateTelemetrySecretBytes,
  loadEncryptionKeyFromEnv,
  telemetrySecretBytesToEnvString,
} from "../lib/crypto";

/**
 * Cloudflare Workers provider adapter (v1).
 *
 * Scope for Slice B:
 * - Deploy a Worker script via Cloudflare API.
 * - Inject a deployment-scoped telemetry signing secret as a Worker secret binding.
 * - Provide an `invoke(...)` helper that POSTs invoke/v1 payloads to the deployed worker URL.
 *
 * Notes / constraints:
 * - This module intentionally keeps Cloudflare API integration minimal and explicit.
 * - Cloudflare API schemas evolve; treat this as an implementation starting point and validate
 *   against Cloudflare API docs during integration.
 * - We do NOT attempt to support every binding type in v1; we include a flexible `bindings` escape hatch.
 *
 * Normative alignment:
 * - ADR-0003: No plaintext secrets in Convex DB.
 * - ADR-0004: Deployment-scoped telemetry signing secret; HMAC over raw bytes verified in control plane.
 * - ADR-0005: Deployments are immutable; provider ref stored on deployment record.
 * - ADR-0006: invoke/v1 payload is forwarded as-is to the data plane worker.
 */

export type CloudflareRuntimeProvider = "cloudflare";

export type CloudflareProviderRef = {
  runtimeProvider: CloudflareRuntimeProvider;

  accountId: string;
  workerName: string;

  /**
   * The externally reachable URL used for invocation.
   * In v1 we use the account's `workers.dev` subdomain.
   */
  workersDevUrl: string;

  /**
   * Where the control plane POSTs `invoke/v1` requests.
   * Your worker implementation should handle this path.
   */
  invokeUrl: string;

  /**
   * Optional metadata for debugging/ops.
   */
  compatibilityDate?: string;
};

export type CloudflareTelemetryAuthRef = {
  type: "cloudflare.telemetrySecret.encrypted.v1";
  bindingName: string;
  encrypted: EncryptedSecretV1;
  createdAtMs: number;
};

export type CloudflareDeployInput = {
  /**
   * Unique script name within the Cloudflare account.
   *
   * Recommendation:
   * - Use a stable prefix + deploymentId, e.g. `whs-agent-<agentId>-dep-<deploymentId>`
   * - Keep within Cloudflare script name limits.
   */
  workerName: string;

  /**
   * ESM module source code as a string for the Worker entrypoint.
   * For real deployments you likely want a built bundle emitted by your build pipeline.
   */
  moduleCode: string;

  /**
   * Name of the module file in the multipart upload.
   * If you bundle to a single module file, keep this as `index.mjs`.
   */
  mainModuleName?: string;

  /**
   * Cloudflare Workers compatibility date for deterministic runtime behavior.
   */
  compatibilityDate?: string;

  /**
   * Optional extra bindings (KV, DO, R2, D1, etc) in Cloudflare's metadata format.
   * This is intentionally typed as unknown because Cloudflare's bindings schema is large.
   */
  bindings?: unknown;

  /**
   * Telemetry secret binding name to inject into the worker (default: `TELEMETRY_SECRET`).
   *
   * Your worker code should read this secret to sign telemetry events.
   */
  telemetrySecretBindingName?: string;

  /**
   * Additional secret env vars to inject (e.g., OPENAI_API_KEY). Values MUST NOT be stored in Convex.
   * In Slice B, you can keep this empty and add a dedicated write-only secrets endpoint later.
   */
  additionalSecrets?: Record<string, string>;

  /**
   * The worker's invocation path. Keep stable and implement in worker code.
   */
  invokePath?: string;
};

export type CloudflareDeployOutput = {
  providerRef: CloudflareProviderRef;
  telemetryAuthRef: CloudflareTelemetryAuthRef;
};

export type CloudflareInvokeInput = {
  providerRef: CloudflareProviderRef;

  /**
   * Raw JSON body for `invoke/v1`.
   * IMPORTANT: your telemetry signature scheme relies on raw bytes, so keep canonical JSON stable.
   */
  body: string;

  /**
   * Optional headers to forward. Keep this tightly controlled; do not forward auth cookies.
   */
  headers?: Record<string, string>;

  /**
   * Control-plane trace id to propagate for correlation.
   */
  traceId?: string;

  /**
   * Abort timeout in milliseconds.
   */
  timeoutMs?: number;
};

export type CloudflareInvokeOutput = {
  status: number;
  /**
   * Returned body as text. The control plane should parse/normalize as needed.
   */
  bodyText: string;
  /**
   * Best-effort response headers for debugging.
   */
  headers: Record<string, string>;
};

type CloudflareEnv = {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;

  /**
   * Your workers.dev subdomain, without `.workers.dev`.
   * Example: if your worker URL is `https://my-script.my-subdomain.workers.dev`,
   * set this to `my-subdomain`.
   */
  CLOUDFLARE_WORKERS_DEV_SUBDOMAIN: string;

  /**
   * 32-byte key, encoded as base64/base64url or hex, used to encrypt telemetry secrets
   * before storing them in Convex.
   *
   * See `convex/lib/crypto.ts` for accepted formats.
   */
  TELEMETRY_SECRETS_ENCRYPTION_KEY: string;
};

function getEnv(): CloudflareEnv {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const subdomain = process.env.CLOUDFLARE_WORKERS_DEV_SUBDOMAIN;
  const encKey = process.env.TELEMETRY_SECRETS_ENCRYPTION_KEY;

  const missing: string[] = [];
  if (!accountId) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!apiToken) missing.push("CLOUDFLARE_API_TOKEN");
  if (!subdomain) missing.push("CLOUDFLARE_WORKERS_DEV_SUBDOMAIN");
  if (!encKey) missing.push("TELEMETRY_SECRETS_ENCRYPTION_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required Cloudflare env vars: ${missing.join(", ")}`,
    );
  }

  return {
    CLOUDFLARE_ACCOUNT_ID: accountId!,
    CLOUDFLARE_API_TOKEN: apiToken!,
    CLOUDFLARE_WORKERS_DEV_SUBDOMAIN: subdomain!,
    TELEMETRY_SECRETS_ENCRYPTION_KEY: encKey!,
  };
}

function buildWorkersDevUrl(args: {
  workerName: string;
  subdomain: string;
}): string {
  // workers.dev uses the pattern: https://<script>.<subdomain>.workers.dev
  return `https://${args.workerName}.${args.subdomain}.workers.dev`;
}

function toHeadersObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers.entries()) out[k] = v;
  return out;
}

function cloudflareApiBase(): string {
  return "https://api.cloudflare.com/client/v4";
}

async function cloudflareApiFetch(args: {
  method: string;
  path: string;
  token: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = args.timeoutMs ?? 30_000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(args.headers);
    headers.set("authorization", `Bearer ${args.token}`);

    return await fetch(`${cloudflareApiBase()}${args.path}`, {
      method: args.method,
      headers,
      body: args.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function requireCloudflareSuccess(res: Response): Promise<any> {
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Cloudflare should return JSON; if it doesn't, treat as error.
    throw new Error(
      `Cloudflare API error (non-JSON response, status ${res.status})`,
    );
  }

  if (!res.ok || !json || json.success !== true) {
    // Avoid leaking token or internal request ids; keep message generic but include status.
    const firstError =
      Array.isArray(json?.errors) && json.errors.length > 0
        ? json.errors[0]
        : null;

    const code = firstError?.code;
    const message = firstError?.message;

    const safeSuffix =
      code || message ? ` (code=${String(code ?? "unknown")})` : "";

    throw new Error(
      `Cloudflare API request failed (status ${res.status})${safeSuffix}`,
    );
  }

  return json;
}

/**
 * Upload a module worker script.
 *
 * Cloudflare's script upload expects multipart/form-data containing:
 * - `metadata`: JSON describing main module, compatibility date, bindings, etc.
 * - a part named as the main module file (e.g. `index.mjs`) containing the source code
 */
async function uploadWorkerModule(args: {
  accountId: string;
  token: string;
  workerName: string;
  mainModuleName: string;
  moduleCode: string;
  compatibilityDate: string;
  bindings?: unknown;
}): Promise<void> {
  const metadata: Record<string, unknown> = {
    main_module: args.mainModuleName,
    compatibility_date: args.compatibilityDate,
  };

  // Bindings schema is provider-defined; we pass through if provided.
  if (args.bindings !== undefined) {
    (metadata as any).bindings = args.bindings;
  }

  const form = new FormData();
  form.set(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  form.set(
    args.mainModuleName,
    new Blob([args.moduleCode], { type: "application/javascript+module" }),
    args.mainModuleName,
  );

  const res = await cloudflareApiFetch({
    method: "PUT",
    path: `/accounts/${encodeURIComponent(args.accountId)}/workers/scripts/${encodeURIComponent(
      args.workerName,
    )}`,
    token: args.token,
    body: form,
    // Do NOT set content-type; fetch will set multipart boundary automatically.
    timeoutMs: 60_000,
  });

  await requireCloudflareSuccess(res);
}

/**
 * Set a Worker secret binding.
 *
 * Cloudflare secrets API typically supports:
 * - PUT /accounts/:account_id/workers/scripts/:script_name/secrets
 * - body: { name, text, type: "secret_text" }
 */
async function putWorkerSecret(args: {
  accountId: string;
  token: string;
  workerName: string;
  name: string;
  text: string;
}): Promise<void> {
  const res = await cloudflareApiFetch({
    method: "PUT",
    path: `/accounts/${encodeURIComponent(args.accountId)}/workers/scripts/${encodeURIComponent(
      args.workerName,
    )}/secrets`,
    token: args.token,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: args.name,
      text: args.text,
      type: "secret_text",
    }),
    timeoutMs: 30_000,
  });

  await requireCloudflareSuccess(res);
}

/**
 * Deploy a Cloudflare Worker (workers.dev-based) and inject telemetry secret binding.
 */
export async function deployCloudflareWorker(
  input: CloudflareDeployInput,
): Promise<CloudflareDeployOutput> {
  const env = getEnv();

  const workerName = input.workerName.trim();
  if (!workerName) throw new Error("workerName is required");

  const mainModuleName = (input.mainModuleName ?? "index.mjs").trim();
  if (!mainModuleName) throw new Error("mainModuleName is required");

  const compatibilityDate = (input.compatibilityDate ?? "2026-01-01").trim();
  if (!compatibilityDate) throw new Error("compatibilityDate is required");

  const telemetryBindingName = (
    input.telemetrySecretBindingName ?? "TELEMETRY_SECRET"
  ).trim();
  if (!telemetryBindingName)
    throw new Error("telemetrySecretBindingName is required");

  const invokePath = (input.invokePath ?? "/invoke").trim();
  if (!invokePath.startsWith("/"))
    throw new Error("invokePath must start with '/'");

  // Generate deployment-scoped telemetry secret
  const telemetrySecretBytes = generateTelemetrySecretBytes(32);

  // Encrypt it for storage (ADR-0003: no plaintext in DB)
  const encryptionKey = loadEncryptionKeyFromEnv({
    envValue: env.TELEMETRY_SECRETS_ENCRYPTION_KEY,
    expectedBytes: 32,
  });

  const encrypted = await encryptSecretV1({
    plaintext: telemetrySecretBytes,
    encryptionKey,
  });

  // 1) Upload worker code
  await uploadWorkerModule({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_API_TOKEN,
    workerName,
    mainModuleName,
    moduleCode: input.moduleCode,
    compatibilityDate,
    bindings: input.bindings,
  });

  // 2) Inject telemetry secret binding
  //    Cloudflare secret values are strings; use base64url encoding for safe transport.
  const telemetrySecretForEnv =
    telemetrySecretBytesToEnvString(telemetrySecretBytes);
  await putWorkerSecret({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_API_TOKEN,
    workerName,
    name: telemetryBindingName,
    text: telemetrySecretForEnv,
  });

  // 3) Optionally inject additional secrets (values never stored in DB)
  if (input.additionalSecrets) {
    for (const [k, v] of Object.entries(input.additionalSecrets)) {
      const key = k.trim();
      if (!key) continue;
      // Avoid accidentally setting telemetry binding twice.
      if (key === telemetryBindingName) continue;

      await putWorkerSecret({
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        token: env.CLOUDFLARE_API_TOKEN,
        workerName,
        name: key,
        text: v,
      });
    }
  }

  const workersDevUrl = buildWorkersDevUrl({
    workerName,
    subdomain: env.CLOUDFLARE_WORKERS_DEV_SUBDOMAIN,
  });

  const providerRef: CloudflareProviderRef = {
    runtimeProvider: "cloudflare",
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    workerName,
    workersDevUrl,
    invokeUrl: `${workersDevUrl}${invokePath}`,
    compatibilityDate,
  };

  const telemetryAuthRef: CloudflareTelemetryAuthRef = {
    type: "cloudflare.telemetrySecret.encrypted.v1",
    bindingName: telemetryBindingName,
    encrypted,
    createdAtMs: Date.now(),
  };

  return { providerRef, telemetryAuthRef };
}

/**
 * Invoke a deployed Cloudflare Worker using the stored providerRef.
 *
 * This sends the `invoke/v1` request to the worker. Your worker should:
 * - validate and execute the request
 * - return a response in your chosen internal format (the gateway normalizes to public API contract)
 */
export async function invokeCloudflareWorker(
  input: CloudflareInvokeInput,
): Promise<CloudflareInvokeOutput> {
  const { providerRef } = input;

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 60_000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(input.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    if (input.traceId) headers.set("x-trace-id", input.traceId);

    // Important: do not forward cookies/auth headers from the browser.
    // This method is intended to be called from the trusted control plane.
    headers.delete("cookie");
    headers.delete("authorization");

    const res = await fetch(providerRef.invokeUrl, {
      method: "POST",
      headers,
      body: input.body,
      signal: controller.signal,
    });

    const bodyText = await res.text();
    return {
      status: res.status,
      bodyText,
      headers: toHeadersObject(res.headers),
    };
  } finally {
    clearTimeout(t);
  }
}
