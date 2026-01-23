import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * webhost.systems — Control plane schema (v1)
 *
 * Normative sources:
 * - project_spec/spec_v1/00_MASTER_SPEC.md
 * - project_spec/spec_v1/10_API_CONTRACTS.md
 * - project_spec/spec_v1/30_DATA_MODEL_CONVEX.md
 *
 * Core invariants enforced by code (not schema):
 * - Tenant isolation: every row is owned by exactly one `userId`.
 * - Deployments are immutable except for status/providerRef/error/timestamps/logsRef.
 * - Telemetry is append-only and integrity-verified at ingestion (HMAC + ownership cross-check).
 */

const runtimeProvider = v.union(v.literal("cloudflare"), v.literal("agentcore"));

const agentStatus = v.union(
  v.literal("draft"),
  v.literal("ready"),
  v.literal("deploying"),
  v.literal("active"),
  v.literal("error"),
  v.literal("disabled"),
  v.literal("deleted")
);

const deploymentStatus = v.union(
  v.literal("deploying"),
  v.literal("active"),
  v.literal("failed"),
  v.literal("inactive")
);

const tier = v.union(
  v.literal("free"),
  v.literal("pro"),
  v.literal("enterprise")
);

const errorClass = v.union(
  v.literal("auth"),
  v.literal("limit"),
  v.literal("runtime"),
  v.literal("tool"),
  v.literal("unknown")
);

export default defineSchema({
  /**
   * System users (single-owner resources in v1).
   *
   * `identitySubject` is the stable identity string from the auth provider
   * (Clerk), and is the primary lookup key used by server functions.
   */
  users: defineTable({
    identitySubject: v.string(), // e.g. "user_..." from Clerk
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),

    tier: tier,
    tierUpdatedAtMs: v.optional(v.number()),

    createdAtMs: v.number(),
    updatedAtMs: v.number(),
  })
    .index("by_identitySubject", ["identitySubject"])
    .index("by_email", ["email"]),

  /**
   * Customer agents (tenant-owned).
   * The agent is the stable resource; deployments are immutable versions.
   */
  agents: defineTable({
    userId: v.id("users"),

    name: v.string(),
    description: v.optional(v.string()),

    status: agentStatus,

    /**
     * List of env var keys that the user may configure via the write-only secrets API.
     * Values MUST NOT be stored in Convex (see ADR-0003).
     */
    envVarKeys: v.array(v.string()),

    /**
     * Routing pointer (ADR-0005).
     * Invocations MUST route only via this pointer (never "latest successful deploy").
     */
    activeDeploymentId: v.optional(v.id("deployments")),

    /**
     * Optional preference for future deploys; routing is always via deployment.runtimeProvider.
     * UI can set this, deploy path validates against entitlements.
     */
    preferredRuntimeProvider: v.optional(runtimeProvider),

    createdAtMs: v.number(),
    updatedAtMs: v.number(),

    disabledAtMs: v.optional(v.number()),
    deletedAtMs: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_status", ["userId", "status"]),

  /**
   * Immutable deployment records (ADR-0005).
   *
   * Mutable subset (enforced by code):
   * - status
   * - providerRef
   * - errorMessage
   * - deployedAtMs / finishedAtMs
   * - logsRef
   */
  deployments: defineTable({
    userId: v.id("users"),
    agentId: v.id("agents"),

    /**
     * Monotonic per agent (assigned by server code).
     */
    version: v.number(),

    protocol: v.literal("invoke/v1"),
    runtimeProvider: runtimeProvider,
    status: deploymentStatus,

    /**
     * Artifact reference used to build/deploy this deployment.
     * Shape is intentionally flexible for v1; validation lives in deploy pipeline.
     */
    artifact: v.optional(
      v.object({
        type: v.string(), // e.g. "bundle", "repo", "template"
        ref: v.optional(v.string()), // URL/hash/path depending on type
        checksum: v.optional(v.string()),
      })
    ),

    /**
     * Provider-specific reference needed to invoke (and cleanup) resources.
     * Example: Cloudflare worker name/url; AgentCore runtime ARN, etc.
     */
    providerRef: v.optional(v.any()),

    /**
     * Reference/metadata for deployment-scoped telemetry signing secret.
     * MUST NOT contain plaintext secret material (ADR-0003, ADR-0004).
     */
    telemetryAuthRef: v.optional(v.any()),

    /**
     * Sanitized error message suitable for UI display; MUST NOT contain secrets.
     */
    errorMessage: v.optional(v.string()),

    logsRef: v.optional(v.any()),

    createdAtMs: v.number(),
    deployedAtMs: v.optional(v.number()),
    finishedAtMs: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_agentId", ["agentId"])
    .index("by_agentId_version", ["agentId", "version"])
    .index("by_agentId_status", ["agentId", "status"]),

  /**
   * Raw metering + observability events (append-only).
   * Authenticated by deployment-scoped signature (ADR-0004).
   */
  metricsEvents: defineTable({
    userId: v.id("users"),
    agentId: v.id("agents"),
    deploymentId: v.id("deployments"),

    runtimeProvider: runtimeProvider,

    /**
     * Data plane generated unique identifier for dedupe within a time window.
     * v1: optional but recommended. If absent, ingestion may dedupe by (deploymentId, traceId).
     */
    eventId: v.optional(v.string()),

    /**
     * Correlates to invocation `traceId` when emitted as part of an invocation.
     */
    traceId: v.optional(v.string()),

    timestampMs: v.number(),

    requests: v.number(), // usually 1
    llmTokens: v.number(), // reported or estimated
    computeMs: v.number(),
    toolCalls: v.optional(v.number()),

    errors: v.number(), // usually 0/1
    errorClass: v.optional(errorClass),

    costUsdEstimated: v.number(),

    /**
     * Provider-specific counters/metadata (must be sanitized; no secrets).
     */
    provider: v.optional(v.any()),
  })
    .index("by_deploymentId_timestampMs", ["deploymentId", "timestampMs"])
    .index("by_userId_timestampMs", ["userId", "timestampMs"])
    .index("by_userId_agentId_timestampMs", ["userId", "agentId", "timestampMs"])
    .index("by_deploymentId_traceId", ["deploymentId", "traceId"])
    .index("by_deploymentId_eventId", ["deploymentId", "eventId"]),

  /**
   * Aggregated usage per billing period (v1: calendar month recommended).
   * This is derived from `metricsEvents` and must be recomputable/idempotent.
   */
  billingUsage: defineTable({
    userId: v.id("users"),
    periodKey: v.string(), // e.g. "2026-01"

    /**
     * Totals across all runtimes for this user+period.
     * UI may also compute per-runtime breakdown by querying `metricsEvents`.
     */
    requests: v.number(),
    llmTokens: v.number(),
    computeMs: v.number(),
    toolCalls: v.optional(v.number()),
    costUsdEstimated: v.number(),

    updatedAtMs: v.number(),
  }).index("by_userId_periodKey", ["userId", "periodKey"]),

  /**
   * Optional but recommended for clarity in v1.
   * Billing integration can be added later; until then tier may be set manually in dev.
   */
  subscriptions: defineTable({
    userId: v.id("users"),

    provider: v.string(), // e.g. "lemonsqueezy"
    providerCustomerId: v.optional(v.string()),
    providerSubscriptionId: v.optional(v.string()),

    status: v.string(), // provider-specific normalized string (e.g. "active", "canceled")
    tier: tier,

    currentPeriodKey: v.optional(v.string()),

    createdAtMs: v.number(),
    updatedAtMs: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_providerSubscriptionId", ["providerSubscriptionId"]),

  /**
   * Append-only audit log (server-written).
   * MUST NOT contain secrets; should include enough metadata to support investigation.
   */
  auditLog: defineTable({
    userId: v.id("users"),
    atMs: v.number(),

    action: v.string(), // e.g. "deployment.create", "deployment.activate", "telemetry.reject"

    /**
     * Optional actor identity info (sanitized). For example, Clerk subject and IP.
     */
    actor: v.optional(
      v.object({
        identitySubject: v.optional(v.string()),
        ip: v.optional(v.string()),
        userAgent: v.optional(v.string()),
      })
    ),

    /**
     * Sanitized metadata, never secret values.
     */
    meta: v.optional(v.any()),
  }).index("by_userId_atMs", ["userId", "atMs"]),
});
