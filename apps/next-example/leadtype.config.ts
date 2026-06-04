import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCollection, defineDocsConfig } from "leadtype";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

export default defineDocsConfig({
  product: {
    name: "Leadtype",
    tagline:
      "Framework-neutral docs pipeline tooling for MDX, LLM bundles, and search.",
    docs: "http://localhost:3000/docs",
    repository: "https://github.com/inthhq/leadtype",
    kind: "library",
  },
  organization: {
    name: "Inth",
    url: "https://inth.com",
  },
  collections: {
    docs: defineCollection({
      repository: repoRoot,
      ref: process.env.LEADTYPE_EXAMPLE_SOURCE_REF ?? "main",
      cacheDir: ".leadtype",
      dir: "docs",
      prefix: "/docs",
      sourceConfig: true,
    }),
  },
});
