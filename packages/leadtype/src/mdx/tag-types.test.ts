import { describe, expect, it } from "vitest";
import type { CalloutProps, TagChildren } from "./tag-types";

// Without a ChildrenTypeRegistry augmentation, children must stay `unknown` —
// registering a type is strictly opt-in and additive.
type IsUnknown<T> = unknown extends T
  ? [T] extends [unknown]
    ? true
    : false
  : false;

describe("tag children typing", () => {
  it("defaults children to unknown when nothing is registered", () => {
    const defaultTagChildren: IsUnknown<TagChildren> = true;
    const defaultCalloutChildren: IsUnknown<
      NonNullable<CalloutProps["children"]>
    > = true;
    expect(defaultTagChildren).toBe(true);
    expect(defaultCalloutChildren).toBe(true);
  });
});
