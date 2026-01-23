import { query } from "../_generated/server";
import { requireCurrentUser } from "../lib/auth";

/**
 * Usage queries (v1).
 *
 * Source of truth:
 * - Aggregated usage is stored in `billingUsage` (derived from `metricsEvents`).
 * - Period standard (v1): calendar month `YYYY-MM` (UTC).
 *
 * This query is intended to back the "current billing period usage" dashboard view.
 */
export const getCurrentPeriodUsage = query({
  args: {},
  handler: async (ctx) => {
    const { userId, user } = await requireCurrentUser(ctx);

    const periodKey = getCurrentPeriodKeyUtc();

    const row = await ctx.db
      .query("billingUsage")
      .withIndex("by_userId_periodKey", (q) =>
        q.eq("userId", userId).eq("periodKey", periodKey),
      )
      .unique();

    const usage = row
      ? normalizeBillingUsageRow(row)
      : {
          userId,
          periodKey,
          requests: 0,
          llmTokens: 0,
          computeMs: 0,
          toolCalls: 0,
          costUsdEstimated: 0,
          updatedAtMs: 0,
        };

    return {
      periodKey,
      tier: user.tier,
      usage,
    };
  },
});

type BillingUsageRow = {
  userId: string;
  periodKey: string;
  requests: number;
  llmTokens: number;
  computeMs: number;
  toolCalls?: number;
  costUsdEstimated: number;
  updatedAtMs: number;
};

function normalizeBillingUsageRow(row: any): BillingUsageRow {
  // We keep this defensive because Convex returns Docs with additional fields (like _id, _creationTime).
  // The schema is the source of truth; this function normalizes optional fields for UI convenience.
  return {
    userId: String(row.userId),
    periodKey: String(row.periodKey),
    requests: numberOrZero(row.requests),
    llmTokens: numberOrZero(row.llmTokens),
    computeMs: numberOrZero(row.computeMs),
    toolCalls: row.toolCalls === undefined ? 0 : numberOrZero(row.toolCalls),
    costUsdEstimated: numberOrZero(row.costUsdEstimated),
    updatedAtMs: numberOrZero(row.updatedAtMs),
  };
}

function numberOrZero(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}

/**
 * v1 period key: calendar month, UTC, formatted as `YYYY-MM`.
 *
 * Example: "2026-01"
 */
function getCurrentPeriodKeyUtc(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1..12
  return `${year}-${String(month).padStart(2, "0")}`;
}
