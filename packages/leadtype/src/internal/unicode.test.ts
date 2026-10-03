import { expect, it } from "vitest";
import { hasUnpairedUtf16Surrogate } from "./unicode";

it("detects unpaired UTF-16 surrogates at every string position", () => {
  expect(hasUnpairedUtf16Surrogate("/api\uD800")).toBe(true);
  expect(hasUnpairedUtf16Surrogate("x\uDBFF")).toBe(true);
  expect(hasUnpairedUtf16Surrogate("\uD800x")).toBe(true);
  expect(hasUnpairedUtf16Surrogate("\uDC00x")).toBe(true);
  expect(hasUnpairedUtf16Surrogate("/api/😀")).toBe(false);
  expect(hasUnpairedUtf16Surrogate("/api/v1")).toBe(false);
});
