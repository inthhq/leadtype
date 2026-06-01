import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { glob as fg } from "tinyglobby";
import { afterEach, describe, expect, it } from "vitest";
import { isDirectRun, runCli } from "./cli";

const tempDirs: string[] = [];
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

type Capture = {
  stderr: string;
  stdout: string;
  io: {
    stderr: { write: (chunk: string) => boolean };
    stdout: { write: (chunk: string) => boolean };
  };
};

function createCapture(): Capture {
  const capture = {
    stderr: "",
    stdout: "",
  };
  return {
    ...capture,
    io: {
      stderr: {
        write: (chunk: string) => {
          capture.stderr += chunk;
          return true;
        },
      },
      stdout: {
        write: (chunk: string) => {
          capture.stdout += chunk;
          return true;
        },
      },
    },
    get stderr() {
      return capture.stderr;
    },
    get stdout() {
      return capture.stdout;
    },
  };
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-cli-"));
  tempDirs.push(dir);
  return dir;
}

async function writeMdxPage(
  srcDir: string,
  relativePath: string,
  frontmatter: string,
  body = "Fixture body."
): Promise<void> {
  const filePath = path.join(srcDir, "docs", relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `---
${frontmatter}
---

# ${path.basename(relativePath, ".mdx")}

${body}
`
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { force: true, recursive: true });
    })
  );
});

describe("leadtype CLI", () => {
  it("treats symlinked package-manager bin paths as direct runs", async () => {
    const fixtureDir = await createTempDir();
    const realCliPath = path.join(fixtureDir, "packages", "leadtype", "dist");
    const linkedPackagePath = path.join(
      fixtureDir,
      "node_modules",
      "leadtype",
      "dist"
    );
    const linkType = process.platform === "win32" ? "junction" : "dir";
    const binPath = path.join(fixtureDir, "node_modules", ".bin", "leadtype");
    const cliPath = path.join(realCliPath, "cli.js");

    await mkdir(realCliPath, { recursive: true });
    await mkdir(path.dirname(binPath), { recursive: true });
    await writeFile(cliPath, "#!/usr/bin/env node\n");
    await symlink(
      path.join(fixtureDir, "packages", "leadtype"),
      path.join(fixtureDir, "node_modules", "leadtype"),
      linkType
    );
    await symlink(path.join(linkedPackagePath, "cli.js"), binPath);

    expect(isDirectRun(binPath, pathToFileURL(cliPath).href)).toBe(true);
    expect(
      isDirectRun(
        path.join(linkedPackagePath, "cli.js"),
        pathToFileURL(cliPath).href
      )
    ).toBe(true);
  });

  it("prints the command list", async () => {
    const capture = createCapture();

    const code = await runCli(["--help"], capture.io);

    expect(code).toBe(0);
    expect(capture.stdout).toContain("leadtype <command>");
    expect(capture.stdout).toContain("generate");
    expect(capture.stdout).toContain("lint");
  });

  it("runs lint against this repo's docs", async () => {
    const capture = createCapture();

    const code = await runCli(
      ["lint", path.join(repoRoot, "docs")],
      capture.io
    );

    expect(code).toBe(0);
    expect(capture.stderr).toContain("files pass.");
  });

  it("generates markdown, LLM files, and search files from this repo's docs", async () => {
    const outDir = await createTempDir();
    const capture = createCapture();

    const code = await runCli(
      [
        "generate",
        "--src",
        repoRoot,
        "--out",
        outDir,
        "--base-url",
        "https://leadtype.dev/leadtype",
        "--name",
        "leadtype",
        "--summary",
        "Shared MDX conversion, linting, and LLM-doc generation package.",
      ],
      capture.io
    );

    expect(code).toBe(0);
    expect(capture.stdout).toBe("");
    expect(capture.stderr).toContain("Generated docs pipeline output");
    expect(
      existsSync(path.join(outDir, "docs", "concepts", "methodology.md"))
    ).toBe(true);
    expect(
      existsSync(path.join(outDir, "docs", "build", "build-a-docs-site.md"))
    ).toBe(true);
    expect(existsSync(path.join(outDir, "llms.txt"))).toBe(true);
    expect(existsSync(path.join(outDir, "llms-full.txt"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "llms.txt"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "llms-full.txt"))).toBe(false);
    expect(existsSync(path.join(outDir, "docs", "llms-full"))).toBe(false);
    expect(existsSync(path.join(outDir, "docs", "search-index.json"))).toBe(
      true
    );
    expect(existsSync(path.join(outDir, "docs", "search-content.json"))).toBe(
      true
    );
    expect(existsSync(path.join(outDir, "docs", "sitemap.xml"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "sitemap.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "robots.txt"))).toBe(true);
    expect(
      existsSync(path.join(outDir, "docs", "agent-readability.json"))
    ).toBe(true);

    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    expect(docsSummary).toContain("Methodology");
    expect(docsSummary).toContain("Build an agent-ready docs site");
    expect(docsSummary).toContain("](/docs/concepts/methodology.md)");

    const llmsFull = await readFile(path.join(outDir, "llms-full.txt"), "utf8");
    expect(llmsFull).toContain("# leadtype Full Context");
    expect(llmsFull).toContain("Methodology");
  });

  it("prints machine-readable generate output for agents", async () => {
    const outDir = await createTempDir();
    const capture = createCapture();

    const code = await runCli(
      [
        "generate",
        "--src",
        repoRoot,
        "--out",
        outDir,
        "--base-url",
        "https://leadtype.dev/leadtype",
        "--name",
        "leadtype",
        "--summary",
        "Shared MDX conversion, linting, and LLM-doc generation package.",
        "--format",
        "json",
      ],
      capture.io
    );

    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout) as {
      files: {
        agentReadabilityManifest: string;
        docsLlmsFullTxt?: string;
        llmsFullTxt: string;
        searchIndex: string;
      };
      groups: Array<{ slug: string }>;
      nav?: Array<{ title: string }>;
      outDir: string;
      search: { docs: number };
    };
    expect(result.outDir).toBe(outDir);
    expect(result.files.searchIndex).toBe(
      path.join(outDir, "docs", "search-index.json")
    );
    expect(result.files.agentReadabilityManifest).toBe(
      path.join(outDir, "docs", "agent-readability.json")
    );
    expect(result.files.llmsFullTxt).toBe(path.join(outDir, "llms-full.txt"));
    expect(result.files.docsLlmsFullTxt).toBeUndefined();
    expect(result.nav?.map((group) => group.title)).toContain("Docs");
    expect(result.search.docs).toBeGreaterThan(0);
  });

  it("loads docs.config.ts for product metadata and group order", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await writeFile(
      path.join(srcDir, "package.json"),
      JSON.stringify({
        description: "Package fallback summary.",
        name: "package-fallback",
      })
    );
    await mkdir(path.join(srcDir, "docs"), { recursive: true });
    await writeFile(
      path.join(srcDir, "docs", "docs.config.ts"),
      `export default {
  product: {
    name: "Configured Product",
    summary: "Configured product summary.",
  },
  groups: [
    { slug: "zeta", title: "Zeta First" },
    { slug: "alpha", title: "Alpha Second" },
  ],
};`
    );
    await writeMdxPage(
      srcDir,
      "alpha.mdx",
      'title: "Alpha"\ndescription: "Alpha docs."\ngroup: alpha'
    );
    await writeMdxPage(
      srcDir,
      "zeta.mdx",
      'title: "Zeta"\ndescription: "Zeta docs."\ngroup: zeta'
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout) as {
      groups: Array<{ slug: string; title: string }>;
      product: { name: string; summary: string };
    };
    expect(result.product).toEqual({
      name: "Configured Product",
      summary: "Configured product summary.",
    });
    expect(result.groups.map((group) => group.slug)).toEqual(["zeta", "alpha"]);
    expect(result.groups.map((group) => group.title)).toEqual([
      "Zeta First",
      "Alpha Second",
    ]);

    const llmsTxt = await readFile(path.join(outDir, "llms.txt"), "utf8");
    expect(llmsTxt).toContain("# Configured Product");
    expect(llmsTxt).toContain("> Configured product summary.");

    const docsLlmsTxt = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    expect(docsLlmsTxt.indexOf("## Zeta First")).toBeLessThan(
      docsLlmsTxt.indexOf("## Alpha Second")
    );
  });

  it("applies config flatteners to custom components during generate", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    // Temp dirs have no node_modules, so import the flattener factory by
    // absolute source path; the `Symbol.for` phase tag works across module
    // instances, so scheduling is unaffected.
    const remarkEntry = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "remark",
      "index.ts"
    );
    await mkdir(path.join(srcDir, "docs"), { recursive: true });
    await writeFile(
      path.join(srcDir, "docs", "docs.config.ts"),
      `import { defineComponentFlattener } from ${JSON.stringify(remarkEntry)};

export default {
  product: { name: "Flattener Product", summary: "Custom flatteners." },
  groups: [{ slug: "guide", title: "Guide" }],
  flatteners: [
    defineComponentFlattener({
      name: "Regulation",
      props: { region: "string" },
      toMarkdown: ({ props, content, b }) =>
        b.blockquote([\`**\${props.region}** \${content}\`]),
    }),
  ],
};`
    );
    await writeMdxPage(
      srcDir,
      "compliance.mdx",
      'title: "Compliance"\ndescription: "Rules."\ngroup: guide',
      '<Regulation region="GDPR">Store consent first.</Regulation>'
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(0);
    const markdown = await readFile(
      path.join(outDir, "docs", "compliance.md"),
      "utf8"
    );
    expect(markdown).toContain("**GDPR** Store consent first.");
    expect(markdown).not.toContain("<Regulation");
  });

  it("generates locale-scoped i18n artifacts while keeping default URLs stable", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "docs"), { recursive: true });
    await writeFile(
      path.join(srcDir, "docs", "docs.config.ts"),
      `export default {
  product: {
    name: "Localized Product",
    summary: "Localized product summary.",
  },
  groups: [{ slug: "get-started", title: "Get Started" }],
  i18n: {
    defaultLocale: "en",
    locales: ["en", "zh"],
  },
};`
    );
    await writeMdxPage(
      srcDir,
      "quickstart.mdx",
      'title: "Quickstart"\ndescription: "English quickstart."\ngroup: get-started',
      "English body."
    );
    await writeMdxPage(
      srcDir,
      "setup.mdx",
      'title: "Setup"\ndescription: "English setup."\ngroup: get-started',
      "English setup."
    );
    await writeMdxPage(
      srcDir,
      "zh/quickstart.mdx",
      'title: "快速开始"\ndescription: "中文快速开始。"\ngroup: get-started',
      "中文正文。"
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout) as {
      files: { i18nManifest?: string };
    };
    expect(result.files.i18nManifest).toBe(
      path.join(outDir, "docs", "i18n-manifest.json")
    );

    const manifest = JSON.parse(
      await readFile(path.join(outDir, "docs", "i18n-manifest.json"), "utf8")
    ) as {
      defaultLocale: string;
      artifacts: Array<{ locale: string; searchIndex: string }>;
    };
    expect(manifest.defaultLocale).toBe("en");
    expect(manifest.artifacts).toContainEqual(
      expect.objectContaining({
        locale: "zh",
        searchIndex: "/docs/zh/search-index.json",
      })
    );

    const defaultSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    expect(defaultSummary).toContain("](/docs/quickstart.md)");

    const zhSummary = await readFile(
      path.join(outDir, "docs", "zh", "llms.txt"),
      "utf8"
    );
    expect(zhSummary).toContain("快速开始");
    expect(zhSummary).toContain("](/docs/zh/quickstart.md)");
    expect(zhSummary).not.toContain("Setup");

    const zhSearch = JSON.parse(
      await readFile(
        path.join(outDir, "docs", "zh", "search-index.json"),
        "utf8"
      )
    ) as { documents: [string, string, string, string][] };
    expect(zhSearch.documents.map((entry) => entry[3])).toEqual([
      "/docs/zh/quickstart",
    ]);
  });

  it("lets --name and --summary override docs config product fields", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "docs"), { recursive: true });
    await writeFile(
      path.join(srcDir, "docs", "docs.config.ts"),
      `export default {
  product: {
    name: "Configured Product",
    summary: "Configured product summary.",
  },
  groups: [{ slug: "guides", title: "Guides" }],
};`
    );
    await writeMdxPage(
      srcDir,
      "quickstart.mdx",
      'title: "Quickstart"\ndescription: "Start here."\ngroup: guides'
    );

    const code = await runCli(
      [
        "generate",
        "--src",
        srcDir,
        "--out",
        outDir,
        "--name",
        "CLI Product",
        "--summary",
        "CLI summary.",
        "--format",
        "json",
      ],
      capture.io
    );

    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout) as {
      product: { name: string; summary: string };
    };
    expect(result.product).toEqual({
      name: "CLI Product",
      summary: "CLI summary.",
    });
  });

  it("infers groups when no docs config exists", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await writeFile(
      path.join(srcDir, "package.json"),
      JSON.stringify({
        description: "Fallback docs summary.",
        name: "fallback-docs",
      })
    );
    await writeMdxPage(
      srcDir,
      "quickstart.mdx",
      'title: "Quickstart"\ndescription: "Start here."\ngroup: getting-started'
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout) as {
      groups: Array<{ slug: string; title: string }>;
      product: { name: string; summary: string };
    };
    expect(result.product).toEqual({
      name: "fallback-docs",
      summary: "Fallback docs summary.",
    });
    expect(result.groups).toEqual([
      { slug: "getting-started", title: "Getting Started" },
    ]);
  });

  it("generates one docs tree from multiple source folders", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "docs"), { recursive: true });
    await writeFile(
      path.join(srcDir, "docs", "docs.config.ts"),
      `export default {
  product: {
    name: "c15t",
    summary: "Consent tooling docs.",
  },
  groups: [
    { slug: "guides", title: "Guides" },
    { slug: "changelog", title: "Changelog" },
  ],
};`
    );
    await writeMdxPage(
      srcDir,
      "quickstart.mdx",
      'title: "Quickstart"\ndescription: "Start here."\ngroup: guides'
    );
    await mkdir(path.join(srcDir, "changelog"), { recursive: true });
    await writeFile(
      path.join(srcDir, "changelog", "v1.mdx"),
      `---
title: "Version 1"
description: "First c15t release."
group: changelog
---

# Version 1

Initial release.
`
    );

    const code = await runCli(
      [
        "generate",
        "--src",
        srcDir,
        "--docs-dir",
        "docs",
        "--docs-dir",
        "changelog",
        "--out",
        outDir,
        "--base-url",
        "https://c15t.com",
        "--format",
        "json",
      ],
      capture.io
    );

    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout) as {
      docsDir: string;
      docsDirs: string[];
    };
    expect(result.docsDir).toBe(path.join(srcDir, "docs"));
    expect(result.docsDirs).toEqual([
      path.join(srcDir, "docs"),
      path.join(srcDir, "changelog"),
    ]);
    expect(existsSync(path.join(outDir, "docs", "quickstart.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "changelog", "v1.md"))).toBe(
      true
    );

    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    expect(docsSummary).toContain("## Changelog");
    expect(docsSummary).toContain("](/docs/changelog/v1.md)");

    const manifest = JSON.parse(
      await readFile(
        path.join(outDir, "docs", "agent-readability.json"),
        "utf8"
      )
    ) as { pages: Array<{ urlPath: string }> };
    expect(manifest.pages.map((page) => page.urlPath)).toContain(
      "/docs/changelog/v1"
    );
  });

  it("expands include partials during generate", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await writeMdxPage(
      srcDir,
      "quickstart.mdx",
      'title: "Quickstart"\ndescription: "Start here."\ngroup: guides',
      '<import src="./shared.mdx#snippet" />'
    );
    await writeFile(
      path.join(srcDir, "docs", "shared.mdx"),
      `<section id="snippet">
Shared content from a partial.
</section>
`
    );

    const code = await runCli(
      [
        "generate",
        "--src",
        srcDir,
        "--out",
        outDir,
        "--name",
        "Fixture",
        "--summary",
        "Fixture docs.",
      ],
      capture.io
    );

    expect(code).toBe(0);
    const markdown = await readFile(
      path.join(outDir, "docs", "quickstart.md"),
      "utf8"
    );
    expect(markdown).toContain("Shared content from a partial.");
    expect(markdown).not.toContain("<import");
  });

  it("resolves AutoTypeTable paths against the source root during generate", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await writeMdxPage(
      srcDir,
      "reference.mdx",
      'title: "Reference"\ndescription: "Type reference."\ngroup: reference',
      '<AutoTypeTable name="ConsentBannerProps" path="./packages/react/src/components/consent-banner/consent-banner.tsx" />'
    );
    await mkdir(path.join(srcDir, "changelog"), { recursive: true });
    await writeFile(
      path.join(srcDir, "changelog", "v1.mdx"),
      `---
title: "v1"
description: "First release."
---

# v1
`
    );
    const typePath = path.join(
      srcDir,
      "packages",
      "react",
      "src",
      "components",
      "consent-banner",
      "consent-banner.tsx"
    );
    await mkdir(path.dirname(typePath), { recursive: true });
    await writeFile(
      typePath,
      `export interface ConsentBannerProps {
  /** Content to display as the banner's title. */
  title?: string;
}
`
    );

    const code = await runCli(
      [
        "generate",
        "--src",
        srcDir,
        "--docs-dir",
        "docs",
        "--docs-dir",
        "changelog=/changelog",
        "--out",
        outDir,
        "--name",
        "Fixture",
        "--summary",
        "Fixture docs.",
      ],
      capture.io
    );

    expect(code).toBe(0);
    const markdown = await readFile(
      path.join(outDir, "docs", "reference.md"),
      "utf8"
    );
    expect(markdown).toContain("title");
    expect(markdown).toContain("Content to display as the banner's title.");
    expect(markdown).not.toContain("Could not extract");
  });

  it("mounts an extra source folder at a custom public URL prefix", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "docs"), { recursive: true });
    await writeFile(
      path.join(srcDir, "docs", "docs.config.ts"),
      `export default {
  product: {
    name: "c15t",
    summary: "Consent tooling docs.",
  },
  groups: [
    { slug: "guides", title: "Guides" },
    { slug: "changelog", title: "Changelog" },
  ],
};`
    );
    await writeMdxPage(
      srcDir,
      "quickstart.mdx",
      'title: "Quickstart"\ndescription: "Start here."\ngroup: guides'
    );
    await mkdir(path.join(srcDir, "changelog"), { recursive: true });
    await writeFile(
      path.join(srcDir, "changelog", "v1.mdx"),
      `---
title: "Version 1"
description: "First c15t release."
group: changelog
---

# Version 1

Initial release.
`
    );

    const code = await runCli(
      [
        "generate",
        "--src",
        srcDir,
        "--docs-dir",
        "docs",
        "--docs-dir",
        "changelog=/changelog",
        "--out",
        outDir,
        "--base-url",
        "https://c15t.com",
        "--format",
        "json",
      ],
      capture.io
    );

    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout) as {
      mounts: Array<{ pathPrefix: string; urlPrefix: string }>;
    };
    expect(result.mounts).toEqual([
      { pathPrefix: "", urlPrefix: "/docs" },
      { pathPrefix: "changelog", urlPrefix: "/changelog" },
    ]);
    expect(existsSync(path.join(outDir, "docs", "changelog", "v1.md"))).toBe(
      true
    );
    expect(existsSync(path.join(outDir, "changelog", "v1.md"))).toBe(true);

    const docsSummary = await readFile(
      path.join(outDir, "docs", "llms.txt"),
      "utf8"
    );
    expect(docsSummary).toContain("](/changelog/v1.md)");
    expect(docsSummary).not.toContain("](/docs/changelog/v1.md)");

    const manifest = JSON.parse(
      await readFile(
        path.join(outDir, "docs", "agent-readability.json"),
        "utf8"
      )
    ) as {
      pages: Array<{
        markdownUrlPath: string;
        relativePath: string;
        urlPath: string;
      }>;
    };
    expect(manifest.pages).toContainEqual(
      expect.objectContaining({
        markdownUrlPath: "/changelog/v1.md",
        relativePath: "changelog/v1",
        urlPath: "/changelog/v1",
      })
    );

    const searchIndex = JSON.parse(
      await readFile(path.join(outDir, "docs", "search-index.json"), "utf8")
    ) as { documents: [string, string, string, string][] };
    expect(searchIndex.documents.map((doc) => doc[3])).toContain(
      "/changelog/v1"
    );
  });

  it("fails clearly when docs config is invalid", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "docs"), { recursive: true });
    await writeFile(
      path.join(srcDir, "docs", "docs.config.ts"),
      "export default { product: { name: 'Broken' } };"
    );
    await writeMdxPage(
      srcDir,
      "quickstart.mdx",
      'title: "Quickstart"\ndescription: "Start here."\ngroup: guides'
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(1);
    const error = JSON.parse(capture.stderr) as { error: string };
    expect(error.error).toContain("failed to load docs config");
    expect(error.error).toContain("product.name and product.summary");
  });

  it("fails when a configured docs set references an unknown group", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "docs"), { recursive: true });
    await writeFile(
      path.join(srcDir, "docs", "docs.config.ts"),
      `export default {
  product: {
    name: "Configured Product",
    summary: "Configured product summary.",
  },
  groups: [{ slug: "guides", title: "Guides" }],
};`
    );
    await writeMdxPage(
      srcDir,
      "quickstart.mdx",
      'title: "Quickstart"\ndescription: "Start here."\ngroup: missing'
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(1);
    const error = JSON.parse(capture.stderr) as { error: string };
    expect(error.error).toContain(
      '/docs/quickstart declares unknown group "missing"'
    );
  });

  it("fails generation when typeTableStrict extraction fails", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "docs"), { recursive: true });
    await writeFile(
      path.join(srcDir, "docs", "docs.config.ts"),
      `export default {
  product: {
    name: "Configured Product",
    summary: "Configured product summary.",
  },
  groups: [{ slug: "guides", title: "Guides" }],
  typeTableStrict: true,
};`
    );
    await writeMdxPage(
      srcDir,
      "quickstart.mdx",
      'title: "Quickstart"\ndescription: "Start here."\ngroup: guides',
      '<AutoTypeTable name="MissingProps" path="./packages/react/missing.ts" />'
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir],
      capture.io
    );

    expect(code).toBe(1);
    expect(capture.stderr).toContain('Could not extract "MissingProps"');
    expect(capture.stderr).toContain("Failed to convert 1 docs file(s).");
  });

  it("filters generated docs by include path globs", async () => {
    const outDir = await createTempDir();
    const capture = createCapture();

    const code = await runCli(
      [
        "generate",
        "--src",
        repoRoot,
        "--out",
        outDir,
        "--include",
        "build/**",
        "--format",
        "json",
      ],
      capture.io
    );

    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout) as {
      filters: { include: string[] };
    };
    expect(result.filters.include).toEqual(["build/**"]);
    expect(
      existsSync(path.join(outDir, "docs", "build", "build-a-docs-site.md"))
    ).toBe(true);
    expect(
      existsSync(
        path.join(outDir, "docs", "build", "optimize-docs-for-agents.md")
      )
    ).toBe(true);
    expect(
      existsSync(path.join(outDir, "docs", "concepts", "methodology.md"))
    ).toBe(false);
  });

  it("applies exclude path globs after includes", async () => {
    const outDir = await createTempDir();
    const capture = createCapture();

    const code = await runCli(
      [
        "generate",
        "--src",
        repoRoot,
        "--out",
        outDir,
        "--include",
        "build/**",
        "--exclude",
        "build/build-a-docs-site.mdx",
      ],
      capture.io
    );

    expect(code).toBe(0);
    expect(
      existsSync(
        path.join(outDir, "docs", "build", "optimize-docs-for-agents.md")
      )
    ).toBe(true);
    expect(
      existsSync(path.join(outDir, "docs", "build", "build-a-docs-site.md"))
    ).toBe(false);
  });

  it("returns structured JSON when filters match no MDX files", async () => {
    const outDir = await createTempDir();
    const capture = createCapture();

    const code = await runCli(
      [
        "generate",
        "--src",
        repoRoot,
        "--out",
        outDir,
        "--include",
        "nope/**",
        "--format",
        "json",
      ],
      capture.io
    );

    expect(code).toBe(1);
    const error = JSON.parse(capture.stderr) as {
      error: string;
      filters: { include: string[] };
    };
    expect(error.error).toContain("No MDX files matched");
    expect(error.filters.include).toEqual(["nope/**"]);
  });

  it("treats a bare directory in --include as matching no MDX files", async () => {
    // tinyglobby expands bare directory names to `dir/**` by default; fast-glob
    // didn't. With expandDirectories disabled at the call site, `--include build`
    // should fail the same way `--include nope` does — not silently include
    // every file under `docs/build/`.
    const outDir = await createTempDir();
    const capture = createCapture();

    const code = await runCli(
      [
        "generate",
        "--src",
        repoRoot,
        "--out",
        outDir,
        "--include",
        "build",
        "--format",
        "json",
      ],
      capture.io
    );

    expect(code).toBe(1);
    const error = JSON.parse(capture.stderr) as {
      error: string;
      filters: { include: string[] };
    };
    expect(error.error).toContain("No MDX files matched");
    expect(error.filters.include).toEqual(["build"]);
  });

  it("rejects invalid generate formats as usage errors", async () => {
    const capture = createCapture();

    const code = await runCli(["generate", "--format", "yaml"], capture.io);

    expect(code).toBe(2);
    expect(capture.stderr).toContain("--format must be text|json");
  });

  it("cleans up mirrored sources when the generate pipeline fails", async () => {
    const srcDir = await createTempDir();
    const outParentDir = await createTempDir();
    const outDir = path.join(outParentDir, "not-a-directory");
    const capture = createCapture();

    await mkdir(path.join(srcDir, "docs", "guides"), { recursive: true });
    await writeFile(
      path.join(srcDir, "package.json"),
      JSON.stringify({
        description: "Fixture docs.",
        name: "fixture-docs",
      })
    );
    await writeFile(
      path.join(srcDir, "docs", "guides", "broken.mdx"),
      `---
title: "Broken"
group: guides
---

# Broken

This page is valid, but the output path is not a directory.
`
    );
    await writeFile(outDir, "not a directory");

    const beforeTempDirs = new Set(
      await fg("leadtype-generate-*", {
        absolute: true,
        cwd: tmpdir(),
        onlyDirectories: true,
      })
    );

    const code = await runCli(
      [
        "generate",
        "--src",
        srcDir,
        "--out",
        outDir,
        "--include",
        "guides/**",
        "--format",
        "json",
      ],
      capture.io
    );

    const afterTempDirs = new Set(
      await fg("leadtype-generate-*", {
        absolute: true,
        cwd: tmpdir(),
        onlyDirectories: true,
      })
    );
    const leakedTempDirs = [...afterTempDirs].filter(
      (dir) => !beforeTempDirs.has(dir)
    );

    expect(code).toBe(1);
    const error = JSON.parse(capture.stderr) as {
      error: string;
      filters: { include: string[] };
    };
    expect(error.error).toBeTruthy();
    expect(error.filters.include).toEqual(["guides/**"]);
    expect(leakedTempDirs).toEqual([]);
  });

  it("emits AGENTS.md and skips llms.txt in --bundle mode", async () => {
    const outDir = await createTempDir();
    const capture = createCapture();

    const code = await runCli(
      [
        "generate",
        "--bundle",
        "--src",
        repoRoot,
        "--out",
        outDir,
        "--name",
        "leadtype",
        "--summary",
        "Bundled docs for leadtype.",
        "--format",
        "json",
      ],
      capture.io
    );

    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout) as {
      files: { agentsMd?: string; docsSitemapXml?: string; llmsTxt?: string };
      mode: string;
    };
    expect(result.mode).toBe("bundle");
    expect(result.files.agentsMd).toBe(path.join(outDir, "AGENTS.md"));
    expect(result.files.llmsTxt).toBeUndefined();
    expect(result.files.docsSitemapXml).toBeUndefined();

    // AGENTS.md exists, has the product header, and uses relative links.
    expect(existsSync(path.join(outDir, "AGENTS.md"))).toBe(true);
    const agentsMd = await readFile(path.join(outDir, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("# leadtype");
    expect(agentsMd).toContain("](./docs/");
    // Bundle mode must NOT emit website artifacts.
    expect(existsSync(path.join(outDir, "llms.txt"))).toBe(false);
    expect(existsSync(path.join(outDir, "llms-full.txt"))).toBe(false);
    expect(existsSync(path.join(outDir, "docs", "llms.txt"))).toBe(false);
    expect(existsSync(path.join(outDir, "docs", "llms-full"))).toBe(false);
    expect(existsSync(path.join(outDir, "docs", "llms-full.txt"))).toBe(false);
    expect(existsSync(path.join(outDir, "docs", "sitemap.xml"))).toBe(false);
    expect(existsSync(path.join(outDir, "docs", "robots.txt"))).toBe(false);
    expect(existsSync(path.join(outDir, "docs", "search-index.json"))).toBe(
      false
    );
    expect(existsSync(path.join(outDir, "docs", "search-content.json"))).toBe(
      false
    );
    // .md files should still ship.
    expect(
      existsSync(path.join(outDir, "docs", "concepts", "methodology.md"))
    ).toBe(true);
    expect(
      existsSync(path.join(outDir, "docs", "build", "build-a-docs-site.md"))
    ).toBe(true);
  });

  it("prints the root-pointer wiring snippet after a --bundle run", async () => {
    const outDir = await createTempDir();
    // The pointer must reference the installable npm name, taken from the
    // output package's package.json — not the human --name.
    await writeFile(
      path.join(outDir, "package.json"),
      JSON.stringify({ name: "acme" })
    );
    const capture = createCapture();

    const code = await runCli(
      [
        "generate",
        "--bundle",
        "--src",
        repoRoot,
        "--out",
        outDir,
        "--name",
        "Acme Toolkit",
        "--summary",
        "Bundled docs for acme.",
      ],
      capture.io
    );

    expect(code).toBe(0);
    expect(capture.stdout).toContain("node_modules/acme/AGENTS.md");
    expect(capture.stdout).toContain("read the bundled docs");
    expect(capture.stdout).toContain(
      "https://leadtype.dev/docs/package-docs/bundle"
    );
  });

  it("keeps stdout clean (no wiring snippet) for --bundle --json", async () => {
    const outDir = await createTempDir();
    const capture = createCapture();

    const code = await runCli(
      [
        "generate",
        "--bundle",
        "--src",
        repoRoot,
        "--out",
        outDir,
        "--name",
        "leadtype",
        "--summary",
        "Bundled docs for leadtype.",
        "--format",
        "json",
      ],
      capture.io
    );

    expect(code).toBe(0);
    expect(capture.stdout).not.toContain("node_modules/");
    // stdout must still parse as a single JSON document.
    expect(() => JSON.parse(capture.stdout)).not.toThrow();
  });

  it("fails clearly when the docs source directory is missing", async () => {
    const tempDir = await createTempDir();
    const capture = createCapture();

    const code = await runCli(
      ["generate", "--src", tempDir, "--docs-dir", "missing"],
      capture.io
    );

    expect(code).toBe(1);
    expect(capture.stderr).toContain("docs directory not found");
  });

  it("generates from leadtype.config.ts collections (local-only)", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    // Two local collections: `guide` at /docs and `changelog` at /changelog.
    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await writeFile(
      path.join(srcDir, "guide", "intro.mdx"),
      '---\ntitle: "Intro"\ndescription: "Guide intro."\n---\n\n# Intro\n\nBody.\n'
    );
    await mkdir(path.join(srcDir, "changelog"), { recursive: true });
    await writeFile(
      path.join(srcDir, "changelog", "v1.mdx"),
      '---\ntitle: "v1"\ndescription: "First release."\n---\n\n# v1\n\nNotes.\n'
    );
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "Collections Product", summary: "Multi-collection demo." },
  collections: {
    guide: { dir: "./guide", prefix: "/docs" },
    changelog: { dir: "./changelog", prefix: "/changelog" },
  },
};`
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir, "--format", "json"],
      capture.io
    );

    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "docs", "intro.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "changelog", "v1.md"))).toBe(true);

    const llmsTxt = await readFile(path.join(outDir, "llms.txt"), "utf8");
    expect(llmsTxt).toContain("# Collections Product");
  });

  it("rejects --docs-dir when leadtype.config.ts defines collections", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await writeFile(
      path.join(srcDir, "guide", "intro.mdx"),
      '---\ntitle: "Intro"\n---\n\nBody.\n'
    );
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  collections: { guide: { dir: "./guide", prefix: "/docs" } },
};`
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir, "--docs-dir", "guide"],
      capture.io
    );

    expect(code).toBe(1);
    expect(capture.stderr).toContain("cannot pass --docs-dir");
    expect(capture.stderr).toContain("collections");
  });

  it("rejects --sync + --refresh together", async () => {
    const capture = createCapture();
    const code = await runCli(["generate", "--sync", "--refresh"], capture.io);
    expect(code).toBe(2);
    expect(capture.stderr).toContain("mutually exclusive");
  });

  it("rejects --sync + --offline together", async () => {
    const capture = createCapture();
    const code = await runCli(["generate", "--sync", "--offline"], capture.io);
    expect(code).toBe(2);
    expect(capture.stderr).toContain("mutually exclusive");
  });

  it("rejects a config that sets both groups and collections", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await writeFile(
      path.join(srcDir, "guide", "intro.mdx"),
      '---\ntitle: "Intro"\n---\n\nBody.\n'
    );
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  groups: [{ slug: "g", title: "G" }],
  collections: { guide: { dir: "./guide", prefix: "/docs" } },
};`
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir],
      capture.io
    );

    expect(code).toBe(1);
    expect(capture.stderr).toContain('sets both "groups" and "collections"');
  });

  it("leadtype sync errors when no leadtype.config.ts is present", async () => {
    const srcDir = await createTempDir();
    const capture = createCapture();

    const code = await runCli(["sync", "--src", srcDir], capture.io);
    expect(code).toBe(2);
    expect(capture.stderr).toContain("no leadtype.config");
  });

  it("leadtype sync errors when the config has no collections", async () => {
    const srcDir = await createTempDir();
    const capture = createCapture();

    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  groups: [{ slug: "g", title: "G" }],
};`
    );

    const code = await runCli(["sync", "--src", srcDir], capture.io);
    expect(code).toBe(2);
    expect(capture.stderr).toContain("no `collections` to sync");
  });

  it("leadtype sync reports 'no remote sources' for local-only collections", async () => {
    const srcDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  collections: { guide: { dir: "./guide", prefix: "/docs" } },
};`
    );

    const code = await runCli(["sync", "--src", srcDir], capture.io);
    expect(code).toBe(0);
    expect(capture.stdout).toContain("No remote sources to sync");
  });

  it("collection.include narrows which MDX files ship", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await writeFile(
      path.join(srcDir, "guide", "intro.mdx"),
      '---\ntitle: "Intro"\n---\n\nBody.\n'
    );
    await writeFile(
      path.join(srcDir, "guide", "draft.mdx"),
      '---\ntitle: "Draft"\n---\n\nDraft body.\n'
    );
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  collections: {
    guide: { dir: "./guide", prefix: "/docs", include: ["intro.mdx"] },
  },
};`
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir],
      capture.io
    );
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "docs", "intro.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "draft.md"))).toBe(false);
  });

  it("collection.exclude drops matching MDX while keeping the rest", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await writeFile(
      path.join(srcDir, "guide", "intro.mdx"),
      '---\ntitle: "Intro"\n---\n\nBody.\n'
    );
    await writeFile(
      path.join(srcDir, "guide", "draft.mdx"),
      '---\ntitle: "Draft"\n---\n\nDraft body.\n'
    );
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  collections: {
    guide: { dir: "./guide", prefix: "/docs", exclude: ["draft.mdx"] },
  },
};`
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir],
      capture.io
    );
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "docs", "intro.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "draft.md"))).toBe(false);
  });

  it("per-collection filters don't bleed across collections", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await mkdir(path.join(srcDir, "changelog"), { recursive: true });
    await writeFile(
      path.join(srcDir, "guide", "intro.mdx"),
      '---\ntitle: "Intro"\n---\n\nBody.\n'
    );
    await writeFile(
      path.join(srcDir, "guide", "draft.mdx"),
      '---\ntitle: "Draft"\n---\n\nDraft body.\n'
    );
    await writeFile(
      path.join(srcDir, "changelog", "draft.mdx"),
      '---\ntitle: "Changelog draft"\n---\n\nDraft body.\n'
    );
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  collections: {
    guide: { dir: "./guide", prefix: "/docs", exclude: ["draft.mdx"] },
    changelog: { dir: "./changelog", prefix: "/changelog" },
  },
};`
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir],
      capture.io
    );
    expect(code).toBe(0);
    // Guide's draft is excluded by its own filter.
    expect(existsSync(path.join(outDir, "docs", "draft.md"))).toBe(false);
    // Changelog's draft is NOT affected by the guide collection's exclude.
    expect(existsSync(path.join(outDir, "changelog", "draft.md"))).toBe(true);
  });

  it("rejects collection.include that isn't an array of strings", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await writeFile(
      path.join(srcDir, "guide", "intro.mdx"),
      '---\ntitle: "Intro"\n---\n\nBody.\n'
    );
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  collections: {
    guide: { dir: "./guide", prefix: "/docs", include: "not-an-array" },
  },
};`
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir],
      capture.io
    );
    expect(code).toBe(1);
    expect(capture.stderr).toContain(
      "include must be an array of glob strings"
    );
  });

  it("treats `--sync --sync` as a single --sync, not a mutex violation", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await writeFile(
      path.join(srcDir, "guide", "intro.mdx"),
      '---\ntitle: "Intro"\n---\n\nBody.\n'
    );
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  collections: { guide: { dir: "./guide", prefix: "/docs" } },
};`
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir, "--sync", "--sync"],
      capture.io
    );
    expect(code).toBe(0);
  });

  it("rejects a collection repository that begins with `-`", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  collections: {
    guide: { repository: "--upload-pack=evil", dir: "docs", prefix: "/docs" },
  },
};`
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir],
      capture.io
    );
    expect(code).toBe(1);
    expect(capture.stderr).toContain('repository must not begin with "-"');
  });

  it("rejects a collection ref that begins with `-`", async () => {
    const srcDir = await createTempDir();
    const outDir = await createTempDir();
    const capture = createCapture();

    await mkdir(path.join(srcDir, "guide"), { recursive: true });
    await writeFile(
      path.join(srcDir, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  collections: {
    guide: {
      repository: "https://github.com/example/repo",
      ref: "--foo",
      dir: "docs",
      prefix: "/docs",
    },
  },
};`
    );

    const code = await runCli(
      ["generate", "--src", srcDir, "--out", outDir],
      capture.io
    );
    expect(code).toBe(1);
    expect(capture.stderr).toContain('ref must not begin with "-"');
  });

  it("lint --src honors the explicit project root when looking for leadtype.config.ts", async () => {
    const monorepoRoot = await createTempDir();
    const packageRoot = path.join(monorepoRoot, "packages", "foo");
    await mkdir(path.join(packageRoot, "guide"), { recursive: true });
    await writeFile(
      path.join(packageRoot, "guide", "intro.mdx"),
      '---\ntitle: "Intro"\n---\n\nBody.\n'
    );
    await writeFile(
      path.join(packageRoot, "leadtype.config.ts"),
      `export default {
  product: { name: "P", summary: "S" },
  collections: { guide: { dir: "./guide", prefix: "/docs" } },
};`
    );

    const capture = createCapture();
    const code = await runCli(["lint", "--src", packageRoot], capture.io);

    expect(code).toBe(0);
    // The collection banner proves we routed through the project config.
    expect(capture.stderr).toContain("Linting collection [guide]");
  });
});
