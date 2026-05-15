import path from "node:path";
import { createMdxSourcePlugins } from "leadtype/mdx";
import { defineNuxtConfig } from "nuxt/config";

const fixtureRoot = path.resolve(process.cwd(), "../../examples/shared-docs");

export default defineNuxtConfig({
  compatibilityDate: "2026-05-15",
  modules: ["@nuxtjs/mdc"],
  css: ["~/assets/styles.css"],
  mdc: {
    remarkPlugins: [
      ...createMdxSourcePlugins({ typeTableBasePath: fixtureRoot }),
    ] as never,
  },
});
