import path from "node:path";
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { createMdxSourcePlugins } from "leadtype/mdx";

const NATIVE_PARSER = "satteri";
const NATIVE_PARSER_BINDING = "@bruits/satteri-";

/**
 * Keep leadtype's MDX parser out of the bundle.
 *
 * `satteri` is a napi-rs module: its loader picks a platform binding with a
 * bare `require("@bruits/satteri-darwin-arm64")`. Bundled into Astro's
 * prerender chunk, that require resolves relative to `dist/.prerender/chunks/`,
 * where the binding isn't reachable — so the static build dies with "Cannot
 * find native binding".
 *
 * Declaring it in `resolve.external` isn't enough: `leadtype` is a workspace
 * package, so Astro's dependency crawl marks it `noExternal`, and noExternal
 * wins. A `resolveId` hook is unambiguous — the import stays a runtime
 * `import "satteri"` and the loader runs from node_modules, where its optional
 * binding packages actually are.
 */
const externalizeNativeParser = {
  name: "leadtype:externalize-native-parser",
  enforce: "pre",
  resolveId(id) {
    if (id === NATIVE_PARSER || id.startsWith(NATIVE_PARSER_BINDING)) {
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
