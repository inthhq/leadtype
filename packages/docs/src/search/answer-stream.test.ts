import { describe, expect, it } from "vitest";
import { getPlainTextResponseInit } from "./answer-stream";

describe("answer stream helpers", () => {
  it("returns fresh plain-text response init objects", () => {
    const first = getPlainTextResponseInit();
    const second = getPlainTextResponseInit();

    expect(first).not.toBe(second);
    expect(first.headers).not.toBe(second.headers);

    const headers = first.headers;
    expect(headers).toBeInstanceOf(Headers);
    if (headers instanceof Headers) {
      headers.set("Cache-Control", "public");
    }

    expect(new Headers(second.headers).get("Cache-Control")).toBe("no-store");
  });
});
