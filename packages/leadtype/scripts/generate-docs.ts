import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import docsConfig from "../../../docs/docs.config";
import { convertAllMdx } from "../src/convert/index";
import { logger } from "../src/internal/logger";
import {
  generateAgentReadabilityArtifacts,
  generateAgentsMd,
  resolveDocsNavigation,
} from "../src/llm/index";
import { defaultRemarkPlugins } from "../src/remark/index";
import { generateDocsSearchFiles } from "../src/search/node-index";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const SRC_DOCS_DIR = join(REPO_ROOT, "docs");
const OUT_DOCS_DIR = join(PACKAGE_ROOT, "docs");

// The output folder is entirely generated and gitignored — safe to nuke.
// Also clear the package-root AGENTS.md and any leftover `llms.txt` /
// `llms-full.txt` from earlier (website-mode) builds.
await rm(OUT_DOCS_DIR, { recursive: true, force: true });
await rm(join(PACKAGE_ROOT, "AGENTS.md"), { force: true });
await rm(join(PACKAGE_ROOT, "llms.txt"), { force: true });
await rm(join(PACKAGE_ROOT, "llms-full.txt"), { force: true });

await convertAllMdx({
  srcDir: SRC_DOCS_DIR,
  outDir: OUT_DOCS_DIR,
  remarkPlugins: defaultRemarkPlugins,
});

// Validate group references against docs.config.ts and fail fast on typos —
// the lint rule covers this in CI, but the package build is also a gate so a
// bad config can't ship.
const navigation = await resolveDocsNavigation({
  srcDir: REPO_ROOT,
  nav: docsConfig.nav,
});
if (navigation.unknown.length > 0) {
  for (const { urlPath, slug } of navigation.unknown) {
    logger.error({
      human: { message: `${urlPath} declares unknown group "${slug}"` },
      json: {
        event: "docs.unknown_group",
        fields: { urlPath, slug },
      },
    });
  }
  process.exit(1);
}

// Emit AGENTS.md at the package root. Every link inside is a relative path to
// the bundled `.md` topic, so the docs remain valid after npm install at
// node_modules/leadtype/ with no URL fetches required.
const { outputPath } = await generateAgentsMd({
  srcDir: REPO_ROOT,
  outDir: PACKAGE_ROOT,
  product: docsConfig.product,
  nav: docsConfig.nav,
});

// Also ship the MCP artifacts (search index + readability manifest) inside the
// tarball — the `--bundle --mcp` story — so a consumer can run a version-matched
// docs MCP server over our own docs: `leadtype mcp --package leadtype`.
// URL-independent, so no base URL is needed.
await generateDocsSearchFiles({ outDir: PACKAGE_ROOT });
await generateAgentReadabilityArtifacts({
  outDir: PACKAGE_ROOT,
  product: docsConfig.product,
  nav: docsConfig.nav,
  jsonLd: docsConfig.agents?.jsonLd,
});

logger.info({
  human: {
    message: `Generated ${outputPath} and ${OUT_DOCS_DIR}/*.md`,
  },
  json: {
    event: "docs.generate.done",
    fields: { outputPath, docsDir: OUT_DOCS_DIR },
  },
});
