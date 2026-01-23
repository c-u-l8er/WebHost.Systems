import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Crypto helpers for webhost.systems control plane (v1).
 *
 * Normative requirements these utilities support:
 * - Telemetry integrity (ADR-0004): HMAC-SHA256 over *raw request body bytes* using a
 *   deployment-scoped secret injected into the data plane.
 * - Secrets strategy (ADR-0003): no plaintext secrets in the primary DB.
 *
 * Notes:
 * - Convex runs in a Node environment for server functions/actions, so we use `node:crypto`.
 * - These helpers are intentionally small and composable. Prefer passing secrets as `Uint8Array`
 *   (bytes) rather than strings when possible.
 */

/** 32 bytes is a good default for HMAC keys and AES-256-GCM keys. */
const DEFAULT_KEY_BYTES = 32;

export type EncryptedSecretV1 = {
  /**
   * Versioned envelope so we can rotate algorithms without breaking stored records.
   */
  v: 1;
  /**
   * Symmetric authenticated encryption.
   */
  alg: "aes-256-gcm";
  /**
   * base64url-encoded IV/nonce (12 bytes recommended for GCM).
   */
  ivB64u: string;
  /**
   * base64url-encoded ciphertext.
   */
  ctB64u: string;
  /**
   * base64url-encoded GCM authentication tag (16 bytes).
   */
  tagB64u: string;
};

/**
 * Generate a random deployment-scoped telemetry signing secret.
 *
 * Recommended: store only encrypted-at-rest material (or provider secret reference), never plaintext.
 * For data plane injection, you may pass the *plaintext* to the provider secret API, but do not store it.
 */
export function generateTelemetrySecretBytes(byteLength = DEFAULT_KEY_BYTES): Uint8Array {
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new Error("Invalid telemetry secret length");
  }
  return randomBytes(byteLength);
}

/**
 * Generate a URL-safe string representation for a telemetry secret (for injection into providers
 * that prefer env var strings).
 *
 * IMPORTANT: Treat the returned string as secret material.
 */
export function generateTelemetrySecretBase64Url(byteLength = DEFAULT_KEY_BYTES): string {
  return base64UrlEncode(generateTelemetrySecretBytes(byteLength));
}

/**
 * Compute hex HMAC-SHA256 over raw bytes.
 *
 * ADR-0004 requires:
 * - signature over the exact raw request body bytes
 * - v1 uses HMAC-SHA256
 * - encoding: hex (lowercase recommended)
 */
export function hmacSha256Hex(key: Uint8Array, data: Uint8Array): string {
  const mac = createHmac("sha256", Buffer.from(key))
    .update(Buffer.from(data))
    .digest("hex");
  return mac;
}

/**
 * Build the canonical telemetry signature header value: `v1=<hex>`.
 */
export function computeTelemetrySignatureHeaderV1(
  telemetrySecret: Uint8Array,
  rawBodyBytes: Uint8Array
): string {
  return `v1=${hmacSha256Hex(telemetrySecret, rawBodyBytes)}`;
}

/**
 * Verify a telemetry signature header of the form `v1=<hex>`.
 *
 * This is constant-time with respect to the signature comparison (timingSafeEqual),
 * assuming both parsed signatures are the same length.
 */
export function verifyTelemetrySignatureHeaderV1(args: {
  telemetrySecret: Uint8Array;
  rawBodyBytes: Uint8Array;
  signatureHeader: string | null;
}): boolean {
  const { telemetrySecret, rawBodyBytes, signatureHeader } = args;
  if (!signatureHeader) return false;

  const parsed = parseTelemetrySignatureHeader(signatureHeader);
  if (!parsed || parsed.version !== "v1") return false;

  const expectedHex = hmacSha256Hex(telemetrySecret, rawBodyBytes);
  return timingSafeEqualHex(expectedHex, parsed.hex);
}

/**
 * Parse `X-Telemetry-Signature` header.
 *
 * Expected format: `v1=<hex>`
 */
export function parseTelemetrySignatureHeader(
  headerValue: string
): { version: "v1"; hex: string } | null {
  const trimmed = headerValue.trim();
  // Allow only the exact `v1=` prefix for v1; future versions can be added later.
  if (!trimmed.toLowerCase().startsWith("v1=")) return null;

  const hex = trimmed.slice(3).trim();
  if (!isLowerHex(hex) && !isUpperHex(hex)) return null;

  // Normalize to lowercase for consistent comparisons.
  return { version: "v1", hex: hex.toLowerCase() };
}

/**
 * Encrypt secret bytes with AES-256-GCM.
 *
 * Storage intent:
 * - Put the resulting `EncryptedSecretV1` object into your DB (e.g. in `deployments.telemetryAuthRef`)
 * - Never store the plaintext secret itself.
 *
 * Key management:
 * - Pass a 32-byte key from an env var (recommended) or a dedicated secret store.
 */
export function encryptSecretV1(args: {
  plaintext: Uint8Array;
  encryptionKey: Uint8Array;
}): EncryptedSecretV1 {
  const { plaintext, encryptionKey } = args;

  assertKeyLength(encryptionKey, 32);

  // 96-bit nonce is recommended for GCM.
  const iv = randomBytes(12);

  const cipher = createCipheriv("aes-256-gcm", Buffer.from(encryptionKey), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: "aes-256-gcm",
    ivB64u: base64UrlEncode(iv),
    ctB64u: base64UrlEncode(ct),
    tagB64u: base64UrlEncode(tag),
  };
}

/**
 * Decrypt a previously encrypted secret.
 */
export function decryptSecretV1(args: {
  encrypted: EncryptedSecretV1;
  encryptionKey: Uint8Array;
}): Uint8Array {
  const { encrypted, encryptionKey } = args;

  if (encrypted.v !== 1 || encrypted.alg !== "aes-256-gcm") {
    throw new Error("Unsupported encrypted secret format");
  }
  assertKeyLength(encryptionKey, 32);

  const iv = base64UrlDecode(encrypted.ivB64u);
  const ct = base64UrlDecode(encrypted.ctB64u);
  const tag = base64UrlDecode(encrypted.tagB64u);

  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(encryptionKey), Buffer.from(iv));
  decipher.setAuthTag(Buffer.from(tag));

  const pt = Buffer.concat([decipher.update(Buffer.from(ct)), decipher.final()]);
  return new Uint8Array(pt);
}

/**
 * Convenience: load a base64url/base64/hex-encoded key from an env var and return bytes.
 *
 * Recommended environment variable: `TELEMETRY_SECRETS_ENCRYPTION_KEY`
 *
 * Accepted formats:
 * - base64url or base64: any string decodable by Buffer.from(x, "base64")
 * - hex: prefix with `hex:` (e.g., `hex:...`)
 * - base64: prefix with `base64:` (optional)
 * - base64url: prefix with `base64url:` (optional)
 */
export function loadEncryptionKeyFromEnv(args: {
  envValue: string | undefined;
  expectedBytes?: number;
}): Uint8Array {
  const expectedBytes = args.expectedBytes ?? 32;
  const value = args.envValue;
  if (!value) {
    throw new Error("Missing encryption key env var");
  }

  const key = decodeKeyString(value);
  assertKeyLength(key, expectedBytes);
  return key;
}

function decodeKeyString(value: string): Uint8Array {
  const trimmed = value.trim();

  // Explicit prefixes
  if (trimmed.startsWith("hex:")) {
    return new Uint8Array(Buffer.from(trimmed.slice(4).trim(), "hex"));
  }
  if (trimmed.startsWith("base64:")) {
    return new Uint8Array(Buffer.from(trimmed.slice(7).trim(), "base64"));
  }
  if (trimmed.startsWith("base64url:")) {
    return base64UrlDecode(trimmed.slice(10).trim());
  }

  // Heuristic: if it's strict hex, decode as hex; otherwise decode as base64.
  if (isLowerHex(trimmed) || isUpperHex(trimmed)) {
    return new Uint8Array(Buffer.from(trimmed, "hex"));
  }

  // Buffer's "base64" decoder accepts base64url variants in modern Node, but we keep our
  // base64url decode explicit elsewhere. Here, base64 decode is the most ergonomic default.
  return new Uint8Array(Buffer.from(trimmed, "base64"));
}

function assertKeyLength(key: Uint8Array, expectedBytes: number): void {
  if (key.byteLength !== expectedBytes) {
    // Do not include the key value in errors.
    throw new Error(`Invalid key length (expected ${expectedBytes} bytes)`);
  }
}

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  if (aHex.length !== bHex.length) return false;
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isLowerHex(s: string): boolean {
  // Empty string is invalid.
  return s.length > 0 && /^[0-9a-f]+$/.test(s);
}

function isUpperHex(s: string): boolean {
  return s.length > 0 && /^[0-9A-F]+$/.test(s);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  // Node 20 supports base64url encoding directly.
  return Buffer.from(bytes).toString("base64url");
}

export function base64UrlDecode(b64url: string): Uint8Array {
  // Node 20 supports base64url decoding directly.
  return new Uint8Array(Buffer.from(b64url, "base64url"));
}
