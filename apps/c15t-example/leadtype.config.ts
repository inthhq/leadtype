import { defineCollection, defineDocsConfig } from "leadtype";

const c15t = {
  repository: "https://github.com/c15t/c15t",
  ref: "main",
  // Keep the existing on-disk path so other scripts that reach into the
  // checkout (e.g. type-table generation) don't need to be reconfigured.
  cacheDir: ".docs-src/c15t",
} as const;

export default defineDocsConfig({
  product: {
    name: "c15t",
    summary: "Developer-first consent management for modern web apps.",
  },
  collections: {
    docs: defineCollection({ ...c15t, dir: "docs", prefix: "/docs" }),
    changelog: defineCollection({
      ...c15t,
      dir: "changelog",
      prefix: "/changelog",
    }),
  },
});
