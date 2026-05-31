import { describe, expect, it } from "vitest";
import { isTransientError, withRetry } from "./retry";

describe("isTransientError", () => {
  it("treats provider 5xx text (no numeric code) as transient", () => {
    // The exact messages gateways surface without a status code — these used to
    // slip through and score a model run as a spurious failure.
    for (const msg of [
      "Internal Server Error",
      "Service Unavailable",
      "Bad Gateway",
      "Gateway Timeout",
      "model temporarily unavailable",
      "at capacity, try again",
    ]) {
      expect(isTransientError(new Error(msg))).toBe(true);
    }
  });

  it("treats numeric 5xx, 429, and network hiccups as transient", () => {
    for (const msg of ["503 error", "429 Too Many Requests", "ECONNRESET", "fetch failed"]) {
      expect(isTransientError(new Error(msg))).toBe(true);
    }
  });

  it("treats real errors as terminal", () => {
    for (const msg of ["400 Bad Request", "invalid_api_key", "schema validation failed"]) {
      expect(isTransientError(new Error(msg))).toBe(false);
    }
  });
});

describe("withRetry", () => {
  it("retries a transient failure then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls++;
        if (calls < 2) {
          return Promise.reject(new Error("Internal Server Error"));
        }
        return Promise.resolve("ok");
      },
      { retries: 3, baseMs: 1 }
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("throws a terminal error without retrying", async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls++;
          return Promise.reject(new Error("400 Bad Request"));
        },
        { retries: 3, baseMs: 1 }
      )
    ).rejects.toThrow(/Bad Request/);
    expect(calls).toBe(1);
  });
});
