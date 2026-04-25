import { describe, expect, it } from "vitest";
import { calloutTitleCase, normalizeCalloutVariant } from "./callout-variant";

describe("normalizeCalloutVariant", () => {
  it("returns the explicit variant when set", () => {
    expect(normalizeCalloutVariant("warning", undefined)).toBe("warning");
    expect(normalizeCalloutVariant("note", undefined)).toBe("note");
  });

  it("variant takes precedence over the legacy type prop", () => {
    expect(normalizeCalloutVariant("info", "warn")).toBe("info");
    expect(normalizeCalloutVariant("error", "tip")).toBe("error");
  });

  it("maps the Fumadocs `warn` alias to `warning`", () => {
    expect(normalizeCalloutVariant(undefined, "warn")).toBe("warning");
  });

  it("passes through other legacy type values unchanged", () => {
    expect(normalizeCalloutVariant(undefined, "note")).toBe("note");
    expect(normalizeCalloutVariant(undefined, "tip")).toBe("tip");
    expect(normalizeCalloutVariant(undefined, "canary")).toBe("canary");
  });

  it("defaults to `info` when both inputs are undefined", () => {
    expect(normalizeCalloutVariant(undefined, undefined)).toBe("info");
  });
});

describe("calloutTitleCase", () => {
  it("title-cases standard variants", () => {
    expect(calloutTitleCase("info")).toBe("Info");
    expect(calloutTitleCase("warning")).toBe("Warning");
    expect(calloutTitleCase("deprecated")).toBe("Deprecated");
  });

  it("preserves `Canary` (already title-cased word in the brand)", () => {
    expect(calloutTitleCase("canary")).toBe("Canary");
  });
});
