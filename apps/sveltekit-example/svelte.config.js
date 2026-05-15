import path from "node:path";
import adapter from "@sveltejs/adapter-auto";
import { createMdxSourcePlugins } from "leadtype/mdx";
import { mdsvex } from "mdsvex";

const fixtureRoot = path.resolve(process.cwd(), "../../examples/shared-docs");

export default {
  extensions: [".svelte", ".svx", ".mdx"],
  preprocess: [
    mdsvex({
      extensions: [".svx", ".mdx"],
      remarkPlugins: [
        ...createMdxSourcePlugins({ typeTableBasePath: fixtureRoot }),
      ],
    }),
  ],
  kit: {
    adapter: adapter(),
  },
};
