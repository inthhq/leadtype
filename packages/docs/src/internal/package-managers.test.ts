import { describe, expect, it } from "vitest";
import { COMMANDS, MANAGERS, resolvePackageCommand } from "./package-managers";

describe("resolvePackageCommand", () => {
  it("renders the run-mode template for a bare command", () => {
    expect(resolvePackageCommand("npm", "@inth/docs", undefined, "run")).toBe(
      "npx @inth/docs"
    );
    expect(resolvePackageCommand("bun", "@inth/docs", undefined, "run")).toBe(
      "bunx @inth/docs"
    );
  });

  it("renders the install-mode template for a bare command", () => {
    expect(
      resolvePackageCommand("npm", "@inth/docs", undefined, "install")
    ).toBe("npm install @inth/docs");
    expect(
      resolvePackageCommand("pnpm", "@inth/docs", undefined, "install")
    ).toBe("pnpm add @inth/docs");
  });

  it("substitutes a `{pm}` placeholder when present (legacy path)", () => {
    expect(
      resolvePackageCommand("yarn", "{pm} install @inth/docs", undefined, "run")
    ).toBe("yarn install @inth/docs");
  });

  it("explicit per-manager overrides win over the template", () => {
    const overrides = { npm: "npm install @inth/docs --legacy-peer-deps" };
    expect(
      resolvePackageCommand("npm", "@inth/docs", overrides, "install")
    ).toBe("npm install @inth/docs --legacy-peer-deps");
  });

  it("respects an empty-string override (suppresses output)", () => {
    expect(
      resolvePackageCommand("yarn", "@inth/docs", { yarn: "" }, "run")
    ).toBe("");
  });

  it("returns empty string when no command and no override is supplied", () => {
    expect(resolvePackageCommand("npm", undefined, undefined, "run")).toBe("");
  });
});

describe("MANAGERS / COMMANDS shape", () => {
  it("declares one template per manager in each mode", () => {
    for (const mode of ["run", "install"] as const) {
      for (const manager of MANAGERS) {
        const template = COMMANDS[mode][manager];
        expect(template).toContain("{pkg}");
      }
    }
  });
});
