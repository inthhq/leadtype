import type { PluggableList } from "unified";
import { describe, expect, it } from "vitest";
import remarkLeadtypeSource from "./source-plugin";

/**
 * The plugin is the unified "preset-as-plugin" idiom: when attached it calls
 * `this.use(createMdxSourcePlugins(options))`. We capture that call with a stub
 * processor to assert it registers the full source preset and forwards options.
 */
function captureRegistration(
  options?: Parameters<typeof remarkLeadtypeSource>[0]
): PluggableList {
  const registered: PluggableList = [];
  const processor = {
    use(plugins: PluggableList) {
      registered.push(...plugins);
      return this;
    },
  };
  (remarkLeadtypeSource as (this: unknown, options?: unknown) => void).call(
    processor,
    options
  );
  return registered;
}

describe("remarkLeadtypeSource", () => {
  it("registers the full MDX source preset (include, type-table, placeholders, imports)", () => {
    expect(captureRegistration()).toHaveLength(4);
  });

  it("forwards the type-table base path to the type-table plugin", () => {
    const registered = captureRegistration({ typeTableBasePath: "/content" });
    const typeTableEntry = registered.find(
      (entry): entry is [unknown, { basePath?: string }] =>
        Array.isArray(entry) &&
        typeof entry[1] === "object" &&
        entry[1] !== null &&
        "basePath" in entry[1]
    );
    expect(typeTableEntry?.[1].basePath).toBe("/content");
  });

  it("defaults to an empty options object without throwing", () => {
    expect(() => captureRegistration()).not.toThrow();
  });
});
