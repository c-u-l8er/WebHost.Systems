/**
 * Crypto helpers for webhost.systems control plane (v1), implemented on top of WebCrypto.
 *
 * Why WebCrypto?
 * - Convex runs most server code in non-Node runtimes (isolates) where Node built-ins like
 *   `node:crypto` and `Buffer` are not available.
 * - WebCrypto (`globalThis.crypto.subtle`) is the portable crypto API available in browsers,
 *   Cloudflare Workers, and Convex isolate runtimes.
 *
 * IMPORTANT API NOTE
 * - WebCrypto is asynchronous, so cryptographic operations here return Promises.
 * - If you previously used synchronous Node crypto helpers, update call sites to `await`.
 *
 * Normative requirements these utilities support:
 * - Telemetry integrity (ADR-0004): HMAC-SHA256 over *raw request body bytes*
 * - Secrets strategy (ADR-0003): no plaintext secrets in the primary DB (encrypt-at-rest)
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
   * base64url-encoded ciphertext (without tag).
   */
  ctB64u: string;
  /**
   * base64url-encoded GCM authentication tag (16 bytes when tagLength=128).
   */
  tagB64u: string;
};

/* -------------------------------------------------------------------------------------------------
 * WebCrypto runtime helpers
 * ------------------------------------------------------------------------------------------------- */

function requireCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c) {
    throw new Error(
      "WebCrypto is not available in this runtime (globalThis.crypto is missing). " +
        "Convex isolate runtimes should provide WebCrypto; ensure you're not running this in a non-WebCrypto environment.",
    );
  }
  return c;
}

function requireSubtle(): SubtleCrypto {
  const subtle = requireCrypto().subtle;
  if (!subtle) {
    throw new Error(
      "WebCrypto subtle crypto is not available in this runtime (globalThis.crypto.subtle is missing).",
    );
  }
  return subtle;
}

/**
 * Convert a Uint8Array into an ArrayBuffer to satisfy DOM `BufferSource` typing.
 *
 * Some TS lib.dom typings treat `Uint8Array` as `Uint8Array<ArrayBufferLike>` which is not
 * assignable to APIs expecting `ArrayBufferView<ArrayBuffer>`. Creating a fresh ArrayBuffer
 * avoids `SharedArrayBuffer`/`ArrayBufferLike` incompatibilities.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

function assertKeyLength(key: Uint8Array, expectedBytes: number): void {
  if (key.byteLength !== expectedBytes) {
    // Do not include the key value in errors.
    throw new Error(`Invalid key length (expected ${expectedBytes} bytes)`);
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function concatManyBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function bytesToHexLower(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, "0");
  }
  return s;
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/* -------------------------------------------------------------------------------------------------
 * Base64 / Base64URL helpers (no Buffer)
 * ------------------------------------------------------------------------------------------------- */

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Uint8Array = (() => {
  // 255 = invalid sentinel
  const table = new Uint8Array(256);
  table.fill(255);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  table["=".charCodeAt(0)] = 254; // padding sentinel
  return table;
})();

function base64Encode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      B64_ALPHABET[(n >>> 18) & 63] +
      B64_ALPHABET[(n >>> 12) & 63] +
      B64_ALPHABET[(n >>> 6) & 63] +
      B64_ALPHABET[n & 63];
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i]!;
    out += B64_ALPHABET[(n >>> 2) & 63] + B64_ALPHABET[(n << 4) & 63] + "==";
  } else if (remaining === 2) {
    const n = (bytes[i]! << 8) | bytes[i + 1]!;
    out +=
      B64_ALPHABET[(n >>> 10) & 63] +
      B64_ALPHABET[(n >>> 4) & 63] +
      B64_ALPHABET[(n << 2) & 63] +
      "=";
  }

  return out;
}

function base64Decode(b64: string): Uint8Array {
  // Remove whitespace
  const s = b64.replace(/\s+/g, "");
  if (s.length === 0) return new Uint8Array();

  if (s.length % 4 !== 0) {
    throw new Error("Invalid base64: length must be a multiple of 4");
  }

  // Compute output length
  let padding = 0;
  if (s.endsWith("==")) padding = 2;
  else if (s.endsWith("=")) padding = 1;

  const outLen = (s.length / 4) * 3 - padding;
  const out = new Uint8Array(outLen);

  let outIdx = 0;

  for (let i = 0; i < s.length; i += 4) {
    const c0 = s.charCodeAt(i);
    const c1 = s.charCodeAt(i + 1);
    const c2 = s.charCodeAt(i + 2);
    const c3 = s.charCodeAt(i + 3);

    const v0 = B64_LOOKUP[c0]!;
    const v1 = B64_LOOKUP[c1]!;
    const v2 = B64_LOOKUP[c2]!;
    const v3 = B64_LOOKUP[c3]!;

    if (v0 === 255 || v1 === 255 || v2 === 255 || v3 === 255) {
      throw new Error("Invalid base64: contains invalid characters");
    }

    // '=' padding is only valid in the final quantum
    const isPad2 = v2 === 254;
    const isPad3 = v3 === 254;
    if (isPad2 && !isPad3) {
      // "x y = z" is invalid
      throw new Error("Invalid base64 padding");
    }

    const b0 = v0 === 254 ? 0 : v0;
    const b1 = v1 === 254 ? 0 : v1;
    const b2 = v2 === 254 ? 0 : v2;
    const b3 = v3 === 254 ? 0 : v3;

    const n = (b0 << 18) | (b1 << 12) | (b2 << 6) | b3;

    if (outIdx < outLen) out[outIdx++] = (n >>> 16) & 255;
    if (!isPad2 && outIdx < outLen) out[outIdx++] = (n >>> 8) & 255;
    if (!isPad3 && outIdx < outLen) out[outIdx++] = n & 255;
  }

  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  // Convert base64 -> base64url (no padding)
  return base64Encode(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlDecode(b64url: string): Uint8Array {
  const s = b64url.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  // Pad to multiple of 4
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = s + (padLen === 0 ? "" : "=".repeat(padLen));
  return base64Decode(padded);
}

/* -------------------------------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------------------------------- */

/**
 * Generate a random deployment-scoped telemetry signing secret.
 *
 * Recommended: store only encrypted-at-rest material (or provider secret reference), never plaintext.
 * For data plane injection, you may pass the plaintext to the provider secret API, but do not store it.
 */
export function generateTelemetrySecretBytes(
  byteLength = DEFAULT_KEY_BYTES,
): Uint8Array {
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new Error("Invalid telemetry secret length");
  }
  const bytes = new Uint8Array(byteLength);
  requireCrypto().getRandomValues(bytes);
  return bytes;
}

/**
 * Generate a URL-safe string representation for a telemetry secret (for injection into providers
 * that prefer env var strings).
 *
 * IMPORTANT: Treat the returned string as secret material.
 */
export function generateTelemetrySecretBase64Url(
  byteLength = DEFAULT_KEY_BYTES,
): string {
  return base64UrlEncode(generateTelemetrySecretBytes(byteLength));
}

/**
 * Compute hex HMAC-SHA256 over raw bytes (lowercase hex).
 *
 * ADR-0004 requires:
 * - signature over the exact raw request body bytes
 * - v1 uses HMAC-SHA256
 * - encoding: hex (lowercase recommended)
 */
export async function hmacSha256Hex(
  key: Uint8Array,
  data: Uint8Array,
): Promise<string> {
  const subtle = requireSubtle();

  const cryptoKey = await subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await subtle.sign("HMAC", cryptoKey, toArrayBuffer(data));
  return bytesToHexLower(new Uint8Array(sig));
}

/**
 * Build the canonical telemetry signature header value: `v1=<hex>`.
 */
export async function computeTelemetrySignatureHeaderV1(
  telemetrySecret: Uint8Array,
  rawBodyBytes: Uint8Array,
): Promise<string> {
  return `v1=${await hmacSha256Hex(telemetrySecret, rawBodyBytes)}`;
}

/**
 * Verify a telemetry signature header of the form `v1=<hex>`.
 *
 * Note: WebCrypto does not expose `timingSafeEqual` directly, so we implement a constant-time
 * byte comparison in JS (`constantTimeEqualBytes`). This is best-effort constant-time.
 */
export async function verifyTelemetrySignatureHeaderV1(args: {
  telemetrySecret: Uint8Array;
  rawBodyBytes: Uint8Array;
  signatureHeader: string | null;
}): Promise<boolean> {
  const { telemetrySecret, rawBodyBytes, signatureHeader } = args;
  if (!signatureHeader) return false;

  const parsed = parseTelemetrySignatureHeader(signatureHeader);
  if (!parsed || parsed.version !== "v1") return false;

  const expectedHex = await hmacSha256Hex(telemetrySecret, rawBodyBytes);

  // Compare as bytes (not strings) to avoid unicode surprises and reduce timing leakage.
  const expected = hexToBytes(expectedHex);
  const provided = hexToBytes(parsed.hex);

  return constantTimeEqualBytes(expected, provided);
}

/**
 * Parse `X-Telemetry-Signature` header.
 *
 * Expected format: `v1=<hex>`
 */
export function parseTelemetrySignatureHeader(
  headerValue: string,
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
export async function encryptSecretV1(args: {
  plaintext: Uint8Array;
  encryptionKey: Uint8Array;
}): Promise<EncryptedSecretV1> {
  const { plaintext, encryptionKey } = args;

  assertKeyLength(encryptionKey, 32);

  const subtle = requireSubtle();

  // 96-bit nonce is recommended for GCM.
  const iv = new Uint8Array(12);
  requireCrypto().getRandomValues(iv);

  const key = await subtle.importKey(
    "raw",
    toArrayBuffer(encryptionKey),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const encrypted = await subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), tagLength: 128 },
    key,
    toArrayBuffer(plaintext),
  );

  const bytes = new Uint8Array(encrypted);
  if (bytes.byteLength < 16) {
    throw new Error("AES-GCM output too short");
  }

  // WebCrypto returns ciphertext || tag
  const tag = bytes.slice(bytes.length - 16);
  const ct = bytes.slice(0, bytes.length - 16);

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
export async function decryptSecretV1(args: {
  encrypted: EncryptedSecretV1;
  encryptionKey: Uint8Array;
}): Promise<Uint8Array> {
  const { encrypted, encryptionKey } = args;

  if (encrypted.v !== 1 || encrypted.alg !== "aes-256-gcm") {
    throw new Error("Unsupported encrypted secret format");
  }
  assertKeyLength(encryptionKey, 32);

  const subtle = requireSubtle();

  const iv = base64UrlDecode(encrypted.ivB64u);
  const ct = base64UrlDecode(encrypted.ctB64u);
  const tag = base64UrlDecode(encrypted.tagB64u);

  if (tag.byteLength !== 16) {
    throw new Error("Invalid AES-GCM tag length (expected 16 bytes)");
  }

  const key = await subtle.importKey(
    "raw",
    toArrayBuffer(encryptionKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const combined = concatBytes(ct, tag);

  const plaintext = await subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), tagLength: 128 },
    key,
    toArrayBuffer(combined),
  );

  return new Uint8Array(plaintext);
}

/**
 * Convenience: load a base64url/base64/hex-encoded key from an env var and return bytes.
 *
 * Recommended environment variable: `TELEMETRY_SECRETS_ENCRYPTION_KEY`
 *
 * Accepted formats:
 * - base64url or base64: any string decodable by base64 logic
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

/* -------------------------------------------------------------------------------------------------
 * Internals
 * ------------------------------------------------------------------------------------------------- */

function decodeKeyString(value: string): Uint8Array {
  const trimmed = value.trim();

  // Explicit prefixes
  if (trimmed.startsWith("hex:")) {
    return hexToBytes(trimmed.slice(4).trim());
  }
  if (trimmed.startsWith("base64:")) {
    return base64Decode(trimmed.slice(7).trim());
  }
  if (trimmed.startsWith("base64url:")) {
    return base64UrlDecode(trimmed.slice(10).trim());
  }

  // Heuristic: if it's strict hex, decode as hex; otherwise decode as base64.
  if (isLowerHex(trimmed) || isUpperHex(trimmed)) {
    return hexToBytes(trimmed);
  }

  // Default: base64url (unpadded).
  //
  // Rationale:
  // - We commonly generate/store keys as base64url without padding for env var friendliness.
  // - This decoder also accepts standard base64 input (it normalizes and pads as needed).
  return base64UrlDecode(trimmed);
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.trim();
  if (s.length === 0 || s.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byteHex = s.slice(i * 2, i * 2 + 2);
    const n = Number.parseInt(byteHex, 16);
    if (!Number.isFinite(n)) throw new Error("Invalid hex string");
    out[i] = n;
  }
  return out;
}

function isLowerHex(s: string): boolean {
  // Empty string is invalid.
  return s.length > 0 && /^[0-9a-f]+$/.test(s);
}

function isUpperHex(s: string): boolean {
  return s.length > 0 && /^[0-9A-F]+$/.test(s);
}

/**
 * A small helper for producing base64url strings in non-Node runtimes without Buffer.
 * This is useful for places where you previously used Buffer.from(bytes).toString("base64url").
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return base64UrlEncode(bytes);
}

/**
 * A small helper for parsing base64url strings into bytes in non-Node runtimes without Buffer.
 */
export function base64UrlToBytes(b64url: string): Uint8Array {
  return base64UrlDecode(b64url);
}

/**
 * If you need a stable "to string" representation of bytes for JSON/debugging.
 * (Not intended for secrets.)
 */
export function bytesToHex(bytes: Uint8Array): string {
  return bytesToHexLower(bytes);
}

/**
 * Build a deterministic "telemetry secret as env var string" value without Node Buffer.
 * This is just an alias for base64url encoding.
 */
export function telemetrySecretBytesToEnvString(
  telemetrySecretBytes: Uint8Array,
): string {
  return base64UrlEncode(telemetrySecretBytes);
}

/**
 * Convenience: parse a hex signature into bytes.
 * Kept internal but exported above via verify path if you need it later.
 */
function signatureHexToBytes(hex: string): Uint8Array {
  return hexToBytes(hex.toLowerCase());
}

/**
 * Compare telemetry signatures by hex (best-effort constant-time).
 */
export function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = signatureHexToBytes(aHex);
  const b = signatureHexToBytes(bHex);
  return constantTimeEqualBytes(a, b);
}

/**
 * Convert UTF-8 string to bytes.
 */
export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Convert bytes to UTF-8 string.
 */
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Deterministically join bytes and compute HMAC. Useful in some signature schemes.
 * Not currently used, but safe to keep as a building block.
 */
export async function hmacSha256HexMany(
  key: Uint8Array,
  parts: Uint8Array[],
): Promise<string> {
  const data = concatManyBytes(parts);
  return await hmacSha256Hex(key, data);
}
