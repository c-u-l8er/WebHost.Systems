/**
 * Period / billing window helpers (v1).
 *
 * Normative reference:
 * - project_spec/spec_v1/30_DATA_MODEL_CONVEX.md (Period standard)
 * - project_spec/spec_v1/50_OBSERVABILITY_BILLING_LIMITS.md (calendar-month periodKey)
 *
 * v1 periodKey format:
 * - Calendar month in UTC: "YYYY-MM"
 *
 * Notes:
 * - These helpers are intentionally dependency-free and deterministic.
 * - All calculations are done in UTC to avoid DST/local timezone ambiguity.
 */

export type PeriodKey = string;

/**
 * Returns the current period key in UTC, formatted as `YYYY-MM`.
 *
 * Example: "2026-01"
 */
export function getCurrentPeriodKeyUtc(now: Date = new Date()): PeriodKey {
  return formatPeriodKeyUtc(now.getUTCFullYear(), now.getUTCMonth() + 1);
}

/**
 * Returns the period key in UTC for a unix timestamp in milliseconds.
 */
export function getPeriodKeyUtcFromMs(timestampMs: number): PeriodKey {
  if (!Number.isFinite(timestampMs)) {
    throw new Error("Invalid timestampMs");
  }
  const d = new Date(Math.trunc(timestampMs));
  return formatPeriodKeyUtc(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

/**
 * Parses a period key `YYYY-MM` into numeric components.
 *
 * Throws on invalid input.
 */
export function parsePeriodKey(periodKey: PeriodKey): {
  year: number;
  month: number; // 1..12
} {
  if (typeof periodKey !== "string") {
    throw new Error("Invalid periodKey");
  }

  // Strict: exactly 7 chars: "YYYY-MM"
  if (periodKey.length !== 7) {
    throw new Error("Invalid periodKey");
  }

  const yearStr = periodKey.slice(0, 4);
  const dash = periodKey[4];
  const monthStr = periodKey.slice(5, 7);

  if (dash !== "-") {
    throw new Error("Invalid periodKey");
  }

  // Avoid Number("0001") weirdness? It's fine; we still validate range.
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new Error("Invalid periodKey");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid periodKey");
  }

  // Ensure the strings were numeric (no "20a6-01").
  if (
    yearStr !== String(year).padStart(4, "0") ||
    monthStr !== String(month).padStart(2, "0")
  ) {
    throw new Error("Invalid periodKey");
  }

  return { year, month };
}

/**
 * Returns true iff `periodKey` is a valid `YYYY-MM` string within our accepted ranges.
 */
export function isValidPeriodKey(periodKey: unknown): periodKey is PeriodKey {
  try {
    parsePeriodKey(String(periodKey));
    return true;
  } catch {
    return false;
  }
}

/**
 * Throws if the periodKey is invalid; otherwise returns it typed as PeriodKey.
 */
export function assertValidPeriodKey(periodKey: unknown): PeriodKey {
  const key = String(periodKey);
  parsePeriodKey(key);
  return key;
}

/**
 * Returns the UTC time bounds for a period key:
 * - startMs (inclusive)
 * - endMsExclusive (exclusive) = start of next month in UTC
 */
export function getPeriodBoundsUtc(periodKey: PeriodKey): {
  startMs: number;
  endMsExclusive: number;
} {
  const { year, month } = parsePeriodKey(periodKey);
  const startMs = Date.UTC(year, month - 1, 1, 0, 0, 0, 0);
  const endMsExclusive = Date.UTC(year, month, 1, 0, 0, 0, 0);
  return { startMs, endMsExclusive };
}

/**
 * Returns the next period key (UTC month increment).
 *
 * Example:
 * - nextPeriodKey("2026-01") => "2026-02"
 * - nextPeriodKey("2026-12") => "2027-01"
 */
export function nextPeriodKey(periodKey: PeriodKey): PeriodKey {
  const { year, month } = parsePeriodKey(periodKey);
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return formatPeriodKeyUtc(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

/**
 * Returns the previous period key (UTC month decrement).
 */
export function prevPeriodKey(periodKey: PeriodKey): PeriodKey {
  const { year, month } = parsePeriodKey(periodKey);
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return formatPeriodKeyUtc(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

/**
 * Adds `deltaMonths` (can be negative) to a periodKey.
 */
export function addMonthsToPeriodKey(
  periodKey: PeriodKey,
  deltaMonths: number,
): PeriodKey {
  if (!Number.isFinite(deltaMonths) || !Number.isInteger(deltaMonths)) {
    throw new Error("Invalid deltaMonths");
  }
  const { year, month } = parsePeriodKey(periodKey);
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + deltaMonths);
  return formatPeriodKeyUtc(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

/**
 * Formats a UTC year/month as a v1 `YYYY-MM` key.
 */
export function formatPeriodKeyUtc(year: number, month: number): PeriodKey {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new Error("Invalid year");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid month");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}
