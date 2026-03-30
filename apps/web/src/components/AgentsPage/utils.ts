import { ApiError } from "../../lib/supabaseApi";

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function summarizeError(err: unknown): string {
  if (err instanceof ApiError) {
    const status = ` status=${err.status}`;
    const retryable =
      typeof err.retryable === "boolean" ? ` retryable=${err.retryable}` : "";

    let details = "";
    if (err.details !== undefined) {
      try {
        details = ` details=${JSON.stringify(err.details)}`;
      } catch {
        details = " details=[unserializable]";
      }
    }

    return `${err.code}: ${err.message} (${status}${retryable})${details}`;
  }

  if (err instanceof Error) return err.message;
  return "Unknown error";
}
