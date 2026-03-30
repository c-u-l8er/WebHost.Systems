import { describe, it, expect } from "vitest";
import { formatDate, clamp, stringifyJson, summarizeError } from "./utils";

// Need ApiError for summarizeError tests
import { ApiError } from "../../lib/supabaseApi";

describe("formatDate", () => {
  it("returns dash for null/undefined", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("formats valid ISO strings", () => {
    const result = formatDate("2026-03-30T12:00:00Z");
    // Should contain date components (locale-dependent)
    expect(result).toContain("2026");
  });

  it("returns string representation for invalid dates", () => {
    expect(formatDate("not-a-date")).toBe("Invalid Date");
  });
});

describe("clamp", () => {
  it("clamps below min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("returns value when in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("handles edge cases", () => {
    expect(clamp(0, 0, 0)).toBe(0);
    expect(clamp(10, 10, 10)).toBe(10);
  });
});

describe("stringifyJson", () => {
  it("stringifies objects with indentation", () => {
    const result = stringifyJson({ a: 1 });
    expect(result).toBe('{\n  "a": 1\n}');
  });

  it("stringifies arrays", () => {
    const result = stringifyJson([1, 2]);
    expect(result).toBe("[\n  1,\n  2\n]");
  });

  it("handles circular references gracefully", () => {
    const obj: any = {};
    obj.self = obj;
    const result = stringifyJson(obj);
    expect(typeof result).toBe("string");
    // Falls back to String()
    expect(result).toBe("[object Object]");
  });

  it("stringifies primitives", () => {
    expect(stringifyJson("hello")).toBe('"hello"');
    expect(stringifyJson(42)).toBe("42");
    expect(stringifyJson(null)).toBe("null");
  });
});

describe("summarizeError", () => {
  it("formats ApiError with all fields", () => {
    const err = new ApiError({
      status: 404,
      code: "NOT_FOUND",
      message: "Agent not found",
      details: { id: "123" },
      retryable: false,
    });

    const result = summarizeError(err);
    expect(result).toContain("NOT_FOUND");
    expect(result).toContain("Agent not found");
    expect(result).toContain("status=404");
    expect(result).toContain("retryable=false");
    expect(result).toContain('details={"id":"123"}');
  });

  it("formats ApiError without optional fields", () => {
    const err = new ApiError({
      status: 500,
      code: "ERR",
      message: "fail",
    });

    const result = summarizeError(err);
    expect(result).toBe("ERR: fail ( status=500)");
  });

  it("formats regular Error", () => {
    const result = summarizeError(new Error("boom"));
    expect(result).toBe("boom");
  });

  it("handles non-Error values", () => {
    expect(summarizeError("string error")).toBe("Unknown error");
    expect(summarizeError(null)).toBe("Unknown error");
    expect(summarizeError(undefined)).toBe("Unknown error");
    expect(summarizeError(42)).toBe("Unknown error");
  });
});
