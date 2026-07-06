import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCollection, defineDocsConfig } from "leadtype";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

function resolveExampleSourceRef(): string {
  const override = process.env.LEADTYPE_EXAMPLE_SOURCE_REF?.trim();
  if (override) {
    return override;
  }

  try {
    const branch = execSync("git branch --show-current", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (branch) {
      return branch;
    }

    return execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "main";
  }
}

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
      ref: resolveExampleSourceRef(),
      cacheDir: ".leadtype",
      dir: "docs",
      mounts: [{ pathPrefix: "changelog", urlPrefix: "/changelog" }],
      prefix: "/docs",
      sourceConfig: true,
    }),
  },
  feeds: [
    {
      id: "changelog",
      title: "Leadtype Changelog",
      description: "Release notes and product updates for Leadtype.",
      source: { urlPrefix: "/changelog" },
      formats: ["rss", "atom"],
      output: {
        rss: "/changelog/rss.xml",
        atom: "/changelog/atom.xml",
      },
    },
  ],
});
