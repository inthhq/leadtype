#!/usr/bin/env bun
/**
 * Reads the package's `docs.config.ts` and `/docs` MDX source, then generates
 * `/llms.txt`, `/docs/llms-full/*.txt`, and a `docs-nav.json` manifest into
 * `apps/example/public/`. The config drives both the package's own published
 * docs bundle and this example app's served bundle — same source, two
 * consumers.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateLLMFullContextFiles,
  generateLlmsTxt,
  resolveDocsNavigation,
} from "@inth/docs/llm";
import docsConfig from "../../../docs/docs.config";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsRoot, "..");
const repoRoot = join(appRoot, "..", "..");
// `generateLlmsTxt` joins `${srcDir}/docs/` and `${outDir}/docs/` internally,
// so we pass the parents (repo root for source, app root/public for output).
const srcDir = repoRoot;
const outDir = join(appRoot, "public");
const generatedDir = join(appRoot, "src", "generated");
// Base URL precedence: package-specific override, generic deployment URL,
// portless local URL, then a stable docs example fallback.
const baseUrl =
  process.env.INTH_DOCS_AGENT_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  process.env.PORTLESS_URL?.trim() ||
  "https://docs.example.com";

await generateLlmsTxt({
  srcDir,
  outDir,
  baseUrl,
  product: docsConfig.product,
  groups: docsConfig.groups,
});

await generateLLMFullContextFiles({
  outDir,
  baseUrl,
  product: { name: docsConfig.product.name },
  groups: docsConfig.groups,
});

// Build the runtime sidebar manifest. Doing this in the build pipeline keeps
// the docs.config.ts as the single source of truth: the same call resolves
// frontmatter membership for the LLM bundles AND for the in-app sidebar.
const navigation = await resolveDocsNavigation({
  srcDir,
  baseUrl,
  groups: docsConfig.groups,
});

if (navigation.unknown.length > 0) {
  for (const { urlPath, slug } of navigation.unknown) {
    process.stderr.write(
      `error: ${urlPath} declares unknown group "${slug}".\n`
    );
  }
  process.exit(1);
}

await mkdir(generatedDir, { recursive: true });
await writeFile(
  join(generatedDir, "docs-nav.json"),
  `${JSON.stringify(navigation, null, 2)}\n`
);

process.stdout.write("LLM files + nav manifest generated\n");
