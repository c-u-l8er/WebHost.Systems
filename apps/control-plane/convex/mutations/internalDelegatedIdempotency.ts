import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Delegated invocation idempotency (INTERNAL) — DB-backed implementation aligned with current schema.
 *
 * Table (schema.ts):
 * - `delegatedInvocationIdempotency`
 *
 * Key (logical):
 * - (userId, agentId, idempotencyKey)
 *
 * Behavior:
 * - If the same idempotency tuple is reused with the same requestHash => replay prior result.
 * - If reused with a different requestHash => conflict (MUST NOT double-run).
 *
 * Notes:
 * - This module is intended to be called from server-to-server delegated invoke endpoints,
 *   after resolving `delegation.externalUserId` to internal `users._id`.
 * - Stored responses/errors must be secret-free and bounded.
 */

const MAX_IDEMPOTENCY_KEY_LEN = 300;
const MAX_REQUEST_HASH_LEN = 128;
const MAX_TRACE_ID_LEN = 200;
const MAX_ERROR_CODE_LEN = 64;
const MAX_ERROR_MESSAGE_LEN = 10_000;
const MAX_STORED_JSON_CHARS = 50_000;

type IdempotencyStatus = Doc<"delegatedInvocationIdempotency">["status"];

function nowMs(): number {
  return Date.now();
}

function assertBoundedString(
  value: unknown,
  field: string,
  maxLen: number,
): string {
  if (typeof value !== "string") throw new Error(`Invalid ${field}`);
  const s = value.trim();
  if (!s) throw new Error(`Invalid ${field}`);
  if (s.length > maxLen) throw new Error(`Invalid ${field}`);
  return s;
}

function normalizeOptionalBoundedString(
  value: unknown,
  maxLen: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s) return undefined;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeIdempotencyKey(value: unknown): string {
  // Deterministic + secret-free is a caller responsibility; here we only bound and trim.
  return assertBoundedString(value, "idempotencyKey", MAX_IDEMPOTENCY_KEY_LEN);
}

/**
 * Request hash format:
 * - recommended: lowercase hex SHA-256 (64 chars)
 * - allowed: any bounded token-ish string so long as it's stable and deterministic for the raw bytes
 */
function normalizeRequestHash(value: unknown): string {
  const s = assertBoundedString(value, "requestHash", MAX_REQUEST_HASH_LEN);

  // If it looks like hex, normalize to lowercase and validate.
  if (/^[0-9a-fA-F]+$/.test(s)) {
    const hex = s.toLowerCase();
    if (hex.length % 2 !== 0) throw new Error("Invalid requestHash");
    return hex;
  }

  // Otherwise allow base64url-ish token (common for hash encodings).
  // Keep conservative: only URL/header-safe characters.
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new Error("Invalid requestHash");
  }

  return s;
}

function limitJsonForStorage(value: unknown, maxChars: number): unknown {
  if (value === undefined) return undefined;

  try {
    const json = JSON.stringify(value);
    if (json.length <= maxChars) return value;

    return {
      __truncated: true,
      maxChars,
      preview: json.slice(0, maxChars),
    };
  } catch {
    return { __unserializable: true };
  }
}

async function loadByKey(
  ctx: any,
  args: {
    userId: Id<"users">;
    agentId: Id<"agents">;
    idempotencyKey: string;
  },
): Promise<Doc<"delegatedInvocationIdempotency"> | null> {
  return await ctx.db
    .query("delegatedInvocationIdempotency")
    .withIndex("by_userId_agentId_idempotencyKey", (q: any) =>
      q
        .eq("userId", args.userId)
        .eq("agentId", args.agentId)
        .eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
}

/**
 * Begin (or replay) a delegated invocation idempotency record.
 *
 * Intended flow:
 * 1) Delegated HTTP handler verifies delegation HMAC + timestamp.
 * 2) Delegated HTTP handler resolves delegated user -> `userId`.
 * 3) Delegated HTTP handler computes requestHash over raw bytes.
 * 4) Call `beginDelegatedInvocation`.
 *    - If `state=replay_*`: return cached response/error without executing provider call.
 *    - If `state=created`: proceed to execute, then call a completion mutation.
 *    - If `state=in_progress`: return a conflict/202 to prompt retry.
 *    - If `state=conflict`: return 409.
 */
export const beginDelegatedInvocation = internalMutation({
  args: {
    userId: v.id("users"),
    agentId: v.id("agents"),
    idempotencyKey: v.string(),
    requestHash: v.string(),

    traceId: v.optional(v.string()),
    deploymentId: v.optional(v.id("deployments")),
  },
  handler: async (ctx, args) => {
    const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
    const requestHash = normalizeRequestHash(args.requestHash);

    const traceId = normalizeOptionalBoundedString(
      args.traceId,
      MAX_TRACE_ID_LEN,
    );
    const deploymentId = args.deploymentId;

    const existing = await loadByKey(ctx, {
      userId: args.userId,
      agentId: args.agentId,
      idempotencyKey,
    });

    if (existing) {
      // Same key, different payload => CONFLICT
      if (existing.requestHash !== requestHash) {
        return {
          ok: false as const,
          state: "conflict" as const,
          message: "Idempotency key reused with different payload",
        };
      }

      if (existing.status === "completed") {
        return {
          ok: true as const,
          state: "replay_success" as const,
          idempotencyId: existing._id,
          response: existing.response ?? null,
          traceId: existing.traceId ?? null,
          deploymentId: existing.deploymentId ?? null,
          createdAtMs: existing.createdAtMs,
          updatedAtMs: existing.updatedAtMs,
        };
      }

      if (existing.status === "failed") {
        return {
          ok: true as const,
          state: "replay_failure" as const,
          idempotencyId: existing._id,
          errorCode: existing.errorCode ?? "RUNTIME_ERROR",
          errorMessage: existing.errorMessage ?? "Delegated invocation failed",
          errorStatus: existing.errorStatus ?? 502,
          traceId: existing.traceId ?? null,
          deploymentId: existing.deploymentId ?? null,
          createdAtMs: existing.createdAtMs,
          updatedAtMs: existing.updatedAtMs,
        };
      }

      // in_progress
      return {
        ok: true as const,
        state: "in_progress" as const,
        idempotencyId: existing._id,
        traceId: existing.traceId ?? null,
        deploymentId: existing.deploymentId ?? null,
        createdAtMs: existing.createdAtMs,
        updatedAtMs: existing.updatedAtMs,
      };
    }

    const ts = nowMs();

    const id = await ctx.db.insert("delegatedInvocationIdempotency", {
      userId: args.userId,
      agentId: args.agentId,
      idempotencyKey,
      requestHash,

      traceId,
      deploymentId,

      status: "in_progress" satisfies IdempotencyStatus,

      response: undefined,
      errorCode: undefined,
      errorMessage: undefined,

      createdAtMs: ts,
      updatedAtMs: ts,
    });

    return {
      ok: true as const,
      state: "created" as const,
      idempotencyId: id,
      createdAtMs: ts,
    };
  },
});

/**
 * Complete an idempotency record as success and persist a replayable response.
 *
 * Idempotency:
 * - If already completed with same requestHash => no-op success.
 * - If already failed with same requestHash => returns "already_failed" (caller may choose behavior).
 * - If requestHash conflicts => conflict.
 */
export const completeDelegatedInvocationSuccess = internalMutation({
  args: {
    userId: v.id("users"),
    agentId: v.id("agents"),
    idempotencyKey: v.string(),
    requestHash: v.string(),

    response: v.any(),

    traceId: v.optional(v.string()),
    deploymentId: v.optional(v.id("deployments")),
  },
  handler: async (ctx, args) => {
    const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
    const requestHash = normalizeRequestHash(args.requestHash);

    const traceId = normalizeOptionalBoundedString(
      args.traceId,
      MAX_TRACE_ID_LEN,
    );
    const deploymentId = args.deploymentId;

    const existing = await loadByKey(ctx, {
      userId: args.userId,
      agentId: args.agentId,
      idempotencyKey,
    });

    if (!existing) {
      return {
        ok: false as const,
        state: "not_found" as const,
        message: "Idempotency record not found (begin must be called first)",
      };
    }

    if (existing.requestHash !== requestHash) {
      return {
        ok: false as const,
        state: "conflict" as const,
        message: "Idempotency key reused with different payload",
      };
    }

    if (existing.status === "completed") {
      return {
        ok: true as const,
        state: "already_completed" as const,
        idempotencyId: existing._id,
        updatedAtMs: existing.updatedAtMs,
      };
    }

    if (existing.status === "failed") {
      return {
        ok: true as const,
        state: "already_failed" as const,
        idempotencyId: existing._id,
        updatedAtMs: existing.updatedAtMs,
      };
    }

    const ts = nowMs();

    await ctx.db.patch(existing._id, {
      status: "completed" satisfies IdempotencyStatus,
      response: limitJsonForStorage(args.response, MAX_STORED_JSON_CHARS),
      errorCode: undefined,
      errorMessage: undefined,
      errorStatus: undefined,

      // Prefer latest traceId/deploymentId if provided (best-effort correlation).
      traceId: traceId ?? existing.traceId,
      deploymentId: deploymentId ?? existing.deploymentId,

      updatedAtMs: ts,
    });

    return {
      ok: true as const,
      state: "completed" as const,
      idempotencyId: existing._id,
      updatedAtMs: ts,
    };
  },
});

/**
 * Complete an idempotency record as failure and persist a replayable error.
 *
 * Notes:
 * - Error MUST be secret-free (caller responsibility; we still bound strings here).
 * - This does not store arbitrary error details in v1 schema (only code/message).
 */
export const completeDelegatedInvocationFailure = internalMutation({
  args: {
    userId: v.id("users"),
    agentId: v.id("agents"),
    idempotencyKey: v.string(),
    requestHash: v.string(),

    errorCode: v.string(),
    errorMessage: v.string(),
    errorStatus: v.optional(v.number()),

    traceId: v.optional(v.string()),
    deploymentId: v.optional(v.id("deployments")),
  },
  handler: async (ctx, args) => {
    const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
    const requestHash = normalizeRequestHash(args.requestHash);

    const errorCode = assertBoundedString(
      args.errorCode,
      "errorCode",
      MAX_ERROR_CODE_LEN,
    );
    const errorMessage = assertBoundedString(
      args.errorMessage,
      "errorMessage",
      MAX_ERROR_MESSAGE_LEN,
    );

    const errorStatusRaw = args.errorStatus;
    const errorStatus =
      typeof errorStatusRaw === "number" &&
      Number.isFinite(errorStatusRaw) &&
      Number.isInteger(errorStatusRaw) &&
      errorStatusRaw >= 100 &&
      errorStatusRaw <= 599
        ? errorStatusRaw
        : 502;

    const traceId = normalizeOptionalBoundedString(
      args.traceId,
      MAX_TRACE_ID_LEN,
    );
    const deploymentId = args.deploymentId;

    const existing = await loadByKey(ctx, {
      userId: args.userId,
      agentId: args.agentId,
      idempotencyKey,
    });

    if (!existing) {
      return {
        ok: false as const,
        state: "not_found" as const,
        message: "Idempotency record not found (begin must be called first)",
      };
    }

    if (existing.requestHash !== requestHash) {
      return {
        ok: false as const,
        state: "conflict" as const,
        message: "Idempotency key reused with different payload",
      };
    }

    if (existing.status === "failed") {
      return {
        ok: true as const,
        state: "already_failed" as const,
        idempotencyId: existing._id,
        updatedAtMs: existing.updatedAtMs,
      };
    }

    if (existing.status === "completed") {
      // Do not overwrite a completed record.
      return {
        ok: false as const,
        state: "already_completed" as const,
        message: "Cannot mark a completed idempotency record as failed",
      };
    }

    const ts = nowMs();

    await ctx.db.patch(existing._id, {
      status: "failed" satisfies IdempotencyStatus,
      response: undefined,
      errorCode,
      errorMessage,
      errorStatus,

      traceId: traceId ?? existing.traceId,
      deploymentId: deploymentId ?? existing.deploymentId,

      updatedAtMs: ts,
    });

    return {
      ok: true as const,
      state: "failed" as const,
      idempotencyId: existing._id,
      updatedAtMs: ts,
    };
  },
});

/**
 * Optional helper mutation: mark an "in_progress" row as refreshed.
 * Useful when a long-running invoke is still underway and you want to bump `updatedAtMs`
 * to prevent aggressive retry loops from treating it as stale.
 */
export const touchDelegatedInvocation = internalMutation({
  args: {
    userId: v.id("users"),
    agentId: v.id("agents"),
    idempotencyKey: v.string(),
    requestHash: v.string(),
  },
  handler: async (ctx, args) => {
    const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey);
    const requestHash = normalizeRequestHash(args.requestHash);

    const existing = await loadByKey(ctx, {
      userId: args.userId,
      agentId: args.agentId,
      idempotencyKey,
    });

    if (!existing) {
      return { ok: false as const, state: "not_found" as const };
    }

    if (existing.requestHash !== requestHash) {
      return { ok: false as const, state: "conflict" as const };
    }

    if (existing.status !== "in_progress") {
      return {
        ok: true as const,
        state: "noop" as const,
        status: existing.status,
      };
    }

    const ts = nowMs();
    await ctx.db.patch(existing._id, { updatedAtMs: ts });

    return { ok: true as const, state: "touched" as const, updatedAtMs: ts };
  },
});
