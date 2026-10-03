import { describe, expect, it } from "vitest";
import type { CalloutProps, TagChildren } from "./tag-types";

// Without a ChildrenTypeRegistry augmentation, children must stay `unknown` —
// registering a type is strictly opt-in and additive.
// `0 extends (1 & T)` is only true for `any`, so a regression from
// `unknown` to `any` fails this assertion too.
type IsAny<T> = 0 extends 1 & T ? true : false;

type IsUnknown<T> =
  IsAny<T> extends true ? false : unknown extends T ? true : false;

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
