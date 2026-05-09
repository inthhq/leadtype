import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import docsConfig from "../../../docs/docs.config";
import { convertAllMdx } from "../src/convert/index";
import { generateAgentsMd, resolveDocsNavigation } from "../src/llm/index";
import { defaultRemarkPlugins } from "../src/remark/index";

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

// Emit AGENTS.md at the package root. Coding agents auto-discover this file
// (Claude Code, Codex, Cursor, Copilot, Aider, etc.) when working in a repo
// that depends on leadtype. Every link inside is a relative path to the
// bundled `.md` topic — no URL fetches required.
const { outputPath } = await generateAgentsMd({
  srcDir: REPO_ROOT,
  outDir: PACKAGE_ROOT,
  product: docsConfig.product,
  groups: docsConfig.groups,
});

process.stdout.write(`Generated ${outputPath} and ${OUT_DOCS_DIR}/*.md\n`);
