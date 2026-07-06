import path from "node:path";
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { createMdxSourcePlugins } from "leadtype/mdx";

export default defineConfig({
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
