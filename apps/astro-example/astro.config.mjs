import path from "node:path";
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { createMdxSourcePlugins } from "leadtype/mdx";

// Kept in step with `packages/leadtype/package.json`'s range. Externalizing
// the import means it resolves to *this app's* copy rather than leadtype's, so
// bumping leadtype's range alone would quietly run a different parser version
// than the package expects.
const NATIVE_PARSER = "satteri";

/**
 * Keep leadtype's MDX parser out of the bundle.
 *
 * `satteri` is a napi-rs module: its loader picks a platform binding with a
 * bare `require("@bruits/satteri-darwin-arm64")`. Bundled into Astro's
 * prerender chunk, that require resolves relative to `dist/.prerender/chunks/`,
 * where the binding isn't reachable — so the static build dies with "Cannot
 * find native binding".
 *
 * This is monorepo-specific: `leadtype` is a linked workspace package, so it
 * is bundled rather than externalized, and `satteri` comes along with it.
 * Declaring `satteri` in `resolve.external` did not take effect here — nor did
 * Astro 6's per-environment `environments.ssr` / `environments.prerender`
 * equivalents, both of which I tried. A `resolveId` hook is unambiguous: the
 * import stays a runtime `import "satteri"`, and the loader runs from
 * node_modules where its optional binding packages actually are.
 *
 * Only `satteri` needs naming. Its loader reaches the platform binding through
 * `createRequire`, so `@bruits/satteri-*` is a runtime CJS call rather than a
 * specifier Vite ever resolves — and once `satteri` is external, Vite does not
 * parse its loader at all.
 */
const externalizeNativeParser = {
  name: "leadtype:externalize-native-parser",
  enforce: "pre",
  resolveId(id) {
    if (id === NATIVE_PARSER) {
      return { id, external: true };
    }
    return null;
  },
};

export default defineConfig({
  vite: {
    plugins: [externalizeNativeParser],
  },
  integrations: [
    mdx({
      remarkPlugins: [
        ...createMdxSourcePlugins({
          typeTableBasePath: path.resolve(process.cwd(), "../.."),
        }),
      ],
    }),
  ],
});
