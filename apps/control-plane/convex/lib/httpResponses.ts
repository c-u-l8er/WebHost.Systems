/**
 * HTTP response helpers for Convex HTTP Actions.
 *
 * Goals:
 * - Provide a consistent JSON response helper.
 * - Provide a normalized error envelope helper aligned with `project_spec/spec_v1/10_API_CONTRACTS.md`.
 * - Avoid leaking sensitive details (secrets, stack traces) in error responses.
 *
 * Note:
 * I don't have runtime access to your deployed environment here, so these helpers are intentionally
 * conservative and framework-agnostic. They can be refined once your API contracts are locked into
 * codegen/types.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

/**
 * Normalized API error envelope (v1).
 *
 * The spec is the source of truth for the exact fields; this shape is designed to be compatible
 * with the common pattern used in `10_API_CONTRACTS.md`:
 * - `error.code` (string)
 * - `error.message` (string, safe to show to users)
 * - `error.details` (optional structured data)
 * - `error.retryable` (optional boolean)
 * - `error.requestId` (optional string for support correlation)
 */
export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: JsonObject;
    retryable?: boolean;
    requestId?: string;
  };
};

export type ApiSuccessEnvelope<T extends JsonValue = JsonValue> = {
  ok: true;
  data: T;
  requestId?: string;
};

export type ApiEnvelope<T extends JsonValue = JsonValue> =
  | ApiSuccessEnvelope<T>
  | ApiErrorEnvelope;

export type JsonResponseOptions = {
  status?: number;
  headers?: HeadersInit;
  requestId?: string;
};

export function jsonResponse<T extends JsonValue>(
  data: T,
  options: JsonResponseOptions = {}
): Response {
  const { status = 200, headers, requestId } = options;

  const h = new Headers(headers);
  h.set("content-type", "application/json; charset=utf-8");
  if (requestId) h.set("x-request-id", requestId);

  // We don't automatically wrap all responses in `{ ok: true, data }` because
  // some endpoints may already be specified as "raw object" responses. Use
  // `okResponse` if you want the wrapped success envelope.
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function okResponse<T extends JsonValue>(
  data: T,
  options: JsonResponseOptions = {}
): Response {
  const envelope: ApiSuccessEnvelope<T> = {
    ok: true,
    data,
    requestId: options.requestId,
  };
  return jsonResponse(envelope, options);
}

export type ErrorResponseOptions = {
  status: number;
  code: string;
  message: string;
  details?: JsonObject;
  retryable?: boolean;
  requestId?: string;
  headers?: HeadersInit;
};

export function errorResponse(options: ErrorResponseOptions): Response {
  const { status, code, message, details, retryable, requestId, headers } =
    options;

  const envelope: ApiErrorEnvelope = {
    error: {
      code,
      message,
      details: details ? sanitizeDetails(details) : undefined,
      retryable,
      requestId,
    },
  };

  const h = new Headers(headers);
  // JSON content-type + correlation id header
  h.set("content-type", "application/json; charset=utf-8");
  if (requestId) h.set("x-request-id", requestId);

  return new Response(JSON.stringify(envelope), { status, headers: h });
}

/**
 * Convert an unknown thrown value into a safe normalized error response.
 *
 * Rules:
 * - Never include stack traces, raw provider errors, or any secret-like strings.
 * - Default to 500 INTERNAL_ERROR unless the error is known/explicitly classified.
 *
 * Use this in HTTP actions as a last-resort catch-all.
 */
export function errorResponseFromUnknown(
  err: unknown,
  requestId?: string
): Response {
  const safe = normalizeUnknownError(err);

  return errorResponse({
    status: safe.status,
    code: safe.code,
    message: safe.message,
    details: safe.details,
    retryable: safe.retryable,
    requestId,
  });
}

export type NormalizedUnknownError = {
  status: number;
  code: string;
  message: string;
  details?: JsonObject;
  retryable?: boolean;
};

/**
 * Lightweight error normalization without depending on any other modules.
 *
 * If you later introduce a richer error taxonomy, keep this function as the bridge
 * between thrown errors and the HTTP contract.
 */
export function normalizeUnknownError(err: unknown): NormalizedUnknownError {
  // If you throw `HttpError` (below), we preserve the classification.
  if (err instanceof HttpError) {
    return {
      status: err.status,
      code: err.code,
      message: err.message,
      details: err.details,
      retryable: err.retryable,
    };
  }

  // If it's a regular Error, use a generic message; avoid leaking `err.message`
  // because it may contain secrets or internal provider details.
  if (err instanceof Error) {
    return {
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      details: {
        // Provide a minimal diagnostic class name for server-side correlation.
        // (Safe: does not include stack trace or message contents.)
        name: err.name,
      },
      retryable: true,
    };
  }

  // Unknown throw types.
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Internal server error",
    retryable: true,
  };
}

/**
 * A structured error you can throw from HTTP action handlers to produce a specific
 * normalized error response.
 */
export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: JsonObject;
  public readonly retryable?: boolean;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    details?: JsonObject;
    retryable?: boolean;
  }) {
    super(args.message);
    this.name = "HttpError";
    this.status = args.status;
    this.code = args.code;
    this.details = args.details ? sanitizeDetails(args.details) : undefined;
    this.retryable = args.retryable;
  }
}

/**
 * Best-effort request id extraction for correlation.
 *
 * Prefer a stable gateway-provided header if you add one later.
 */
export function getRequestIdFromHeaders(headers: Headers): string | undefined {
  // Common correlation headers
  return (
    headers.get("x-request-id") ??
    headers.get("cf-ray") ??
    headers.get("x-amzn-trace-id") ??
    undefined
  );
}

/**
 * Ensure error details are JSON-serializable and do not contain obvious secrets.
 *
 * This is a best-effort sanitizer. The real defense is: never put secrets into errors.
 */
function sanitizeDetails(details: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(details)) {
    out[k] = sanitizeValue(k, v);
  }
  return out;
}

function sanitizeValue(key: string, value: JsonValue): JsonValue {
  const loweredKey = key.toLowerCase();

  // Redact obvious secret fields by key name.
  if (
    loweredKey.includes("secret") ||
    loweredKey.includes("token") ||
    loweredKey.includes("password") ||
    loweredKey.includes("api_key") ||
    loweredKey.includes("apikey") ||
    loweredKey.includes("authorization")
  ) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    // Best-effort: redact high-entropy-looking values when the key is suspicious.
    // (We avoid doing entropy checks; keep it simple and predictable.)
    if (value.length > 64 && loweredKey.includes("key")) return "[REDACTED]";
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(key, v));
  }

  if (value && typeof value === "object") {
    const obj = value as JsonObject;
    const nested: JsonObject = {};
    for (const [k, v] of Object.entries(obj)) {
      nested[k] = sanitizeValue(k, v);
    }
    return nested;
  }

  return value;
}
