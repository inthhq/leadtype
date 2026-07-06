import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import docsConfig from "../../../docs/docs.config";
import { convertAllMdx } from "../src/convert/index";
import { logger } from "../src/internal/logger";
import {
  generateAgentReadabilityArtifacts,
  generateAgentsMd,
  generateSkillArtifacts,
  resolveAgentInputs,
  resolveDocsNavigation,
} from "../src/llm/index";
import { defaultMarkdownTransforms } from "../src/markdown/index";
import { stageOpenApiDocs } from "../src/openapi/index";
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
await rm(join(PACKAGE_ROOT, "SKILL.md"), { force: true });
await rm(join(PACKAGE_ROOT, "llms.txt"), { force: true });
await rm(join(PACKAGE_ROOT, "llms-full.txt"), { force: true });

// Stage generated OpenAPI pages next to the authored docs (in a temp copy)
// so they flow through conversion, nav, search, and agent artifacts.
const staged =
  docsConfig.openapi === undefined
    ? undefined
    : await stageOpenApiDocs({
        contentDir: SRC_DOCS_DIR,
        openapi: docsConfig.openapi,
      });
const docsDir = staged?.contentDir ?? SRC_DOCS_DIR;
const srcRoot = staged ? dirname(staged.contentDir) : REPO_ROOT;
const docsNavigation = [
  ...(docsConfig.navigation ?? []),
  ...(staged?.nav ?? []),
];

try {
  await convertAllMdx({
    srcDir: docsDir,
    outDir: OUT_DOCS_DIR,
    markdownTransforms: defaultMarkdownTransforms,
  });

  // Validate group references against docs.config.ts and fail fast on typos —
  // the lint rule covers this in CI, but the package build is also a gate so a
  // bad config can't ship.
  const agentInputs = resolveAgentInputs({
    product: docsConfig.product,
    organization: docsConfig.organization,
    llms: docsConfig.llms,
  });

  const navigation = await resolveDocsNavigation({
    srcDir: srcRoot,
    nav: docsNavigation,
    mounts: docsConfig.mounts,
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
    srcDir: srcRoot,
    outDir: PACKAGE_ROOT,
    product: agentInputs.product,
    nav: docsNavigation,
  });

  // Also ship the MCP artifacts (search index + readability manifest) inside the
  // tarball — the `--bundle --mcp` story — so a consumer can run a version-matched
  // docs MCP server over our own docs: `leadtype mcp --package leadtype`.
  // URL-independent, so no base URL is needed.
  await generateDocsSearchFiles({
    outDir: PACKAGE_ROOT,
    mounts: docsConfig.mounts,
  });
  await generateAgentReadabilityArtifacts({
    outDir: PACKAGE_ROOT,
    product: {
      name: agentInputs.product.name,
      summary: agentInputs.product.summary,
    },
    nav: docsNavigation,
    mounts: docsConfig.mounts,
    jsonLd: agentInputs.jsonLd,
  });

  // Ship the docs-skill SKILL.md next to AGENTS.md so on-disk agents discover it the
  // same way they discover AGENTS.md (offline, version-matched). Bundle MCP is on.
  await generateSkillArtifacts({
    outDir: PACKAGE_ROOT,
    srcDir: REPO_ROOT,
    product: {
      name: agentInputs.product.name,
      summary: agentInputs.product.summary,
    },
    skills: docsConfig.agents?.skills,
    mode: "bundle",
    mcpEnabled: true,
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
} finally {
  await staged?.cleanup();
}
