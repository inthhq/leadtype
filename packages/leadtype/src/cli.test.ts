import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./cli";

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
    expect(existsSync(path.join(outDir, "docs", "methodology.md"))).toBe(true);
    expect(
      existsSync(path.join(outDir, "docs", "build", "connect-docs-site.md"))
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
    expect(docsSummary).toContain("Connect a docs site");
    expect(docsSummary).toContain("](/docs/methodology.md)");

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
    expect(result.groups.map((group) => group.slug)).toContain("docs-site");
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
      existsSync(path.join(outDir, "docs", "build", "connect-docs-site.md"))
    ).toBe(true);
    expect(
      existsSync(path.join(outDir, "docs", "build", "add-search.md"))
    ).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "methodology.md"))).toBe(false);
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
        "build/connect-docs-site.mdx",
      ],
      capture.io
    );

    expect(code).toBe(0);
    expect(
      existsSync(path.join(outDir, "docs", "build", "add-search.md"))
    ).toBe(true);
    expect(
      existsSync(path.join(outDir, "docs", "build", "connect-docs-site.md"))
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
    expect(existsSync(path.join(outDir, "docs", "methodology.md"))).toBe(true);
    expect(
      existsSync(path.join(outDir, "docs", "build", "connect-docs-site.md"))
    ).toBe(true);
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
});
