import { rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import docsConfig from "../../../docs/docs.config";
import { convertAllMdx } from "../src/convert/index";
import {
  generateLLMFullContextFiles,
  generateLlmsTxt,
  resolveDocsNavigation,
} from "../src/llm/index";
import { defaultRemarkPlugins } from "../src/remark/index";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const SRC_DOCS_DIR = join(REPO_ROOT, "docs");
const OUT_DOCS_DIR = join(PACKAGE_ROOT, "docs");

const fallbackBaseUrl = "https://example.invalid/@inth/docs";
const configuredBaseUrl = process.env.INTH_DOCS_AGENT_BASE_URL?.trim();
const baseUrl = configuredBaseUrl || fallbackBaseUrl;

if (!configuredBaseUrl) {
  process.stderr.write(
    `INTH_DOCS_AGENT_BASE_URL not set; using ${fallbackBaseUrl} for generated package docs.\n`
  );
}

// The output folder is entirely generated and gitignored — safe to nuke.
// This also clears the root-level `llms.txt` / `llms-full.txt` byproducts
// emitted by the llm helper at PACKAGE_ROOT.
await rm(OUT_DOCS_DIR, { recursive: true, force: true });
await rm(join(PACKAGE_ROOT, "llms.txt"), { force: true });
await rm(join(PACKAGE_ROOT, "llms-full.txt"), { force: true });

await convertAllMdx({
  srcDir: SRC_DOCS_DIR,
  outDir: OUT_DOCS_DIR,
  remarkPlugins: defaultRemarkPlugins,
});

// `generateLlmsTxt` and `generateLLMFullContextFiles` join `${dir}/docs/`
// internally, so we pass the parents (REPO_ROOT, PACKAGE_ROOT) — they then
// read source MDX from `<repo>/docs/` and write outputs to `<package>/docs/`.
await generateLlmsTxt({
  srcDir: REPO_ROOT,
  outDir: PACKAGE_ROOT,
  baseUrl,
  product: docsConfig.product,
  groups: docsConfig.groups,
});

await generateLLMFullContextFiles({
  outDir: PACKAGE_ROOT,
  baseUrl,
  product: { name: docsConfig.product.name },
  groups: docsConfig.groups,
});

// Surface unknown-group references early — the lint rule catches typos in
// CI, but the build script also fails fast so a bad config can't ship.
const navigation = await resolveDocsNavigation({
  srcDir: REPO_ROOT,
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

await writeFile(
  join(OUT_DOCS_DIR, "navigation.json"),
  `${JSON.stringify(navigation, null, 2)}\n`
);

process.stdout.write(`Generated docs in ${OUT_DOCS_DIR}\n`);
