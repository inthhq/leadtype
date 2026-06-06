import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "tinyglobby";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const exportedPaths = Object.keys(packageJson.exports);

// Adapter directories are allowed to import from their declared optional peer.
// Everything else under `src/` must stay framework-neutral.
const ADAPTER_DIRECTORIES = [
  "astro/",
  "fumadocs/",
  "next/",
  "nuxt/",
  "sveltekit/",
  "tanstack-start/",
] as const;
const FRAMEWORK_RUNTIME_DIRECTORIES = [
  ...ADAPTER_DIRECTORIES,
  "search/react.ts",
  "search/vue.ts",
  "search/svelte.ts",
] as const;

// Banned framework runtimes. Adapter directories may import their matching
// peer (e.g. `next/`'s adapter may import from `react`); core code may not.
const FRAMEWORK_RUNTIME_IMPORTS = [
  "react",
  "react-dom",
  "next/",
  "next$",
  "nuxt/",
  "nuxt$",
  "@nuxt/",
  "vue",
  "@vue/",
  "svelte",
  "@sveltejs/",
  "astro",
  "solid-js",
  "@solidjs/",
] as const;

const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)(?:\s+type)?\s+(?:[^"']+from\s+)?["']([^"']+)["']/g;
const MODULE_CALL_PATTERN = /\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g;

function readSrc(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of [IMPORT_PATTERN, MODULE_CALL_PATTERN]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        specifiers.push(match[1]);
      }
    }
  }
  return specifiers;
}

function matchesBannedSpecifier(specifier: string, banned: string): boolean {
  if (banned.endsWith("/")) {
    return specifier === banned.slice(0, -1) || specifier.startsWith(banned);
  }
  if (banned.endsWith("$")) {
    return specifier === banned.slice(0, -1);
  }
  return specifier === banned || specifier.startsWith(`${banned}/`);
}

describe("package surface", () => {
  it("matches the documented entry-point list", () => {
    const expectedExportedPaths = [
      ".",
      "./package.json",
      "./mdx",
      "./mdx/source",
      "./feed",
      "./fumadocs",
      "./astro",
      "./i18n",
      "./nuxt",
      "./next",
      "./next/client",
      "./remark",
      "./transformers",
      "./convert",
      "./llm",
      "./llm/readability",
      "./navigation",
      "./search",
      "./search/client",
      "./search/react",
      "./search/vue",
      "./search/svelte",
      "./search/node",
      "./search/ai",
      "./search/bash",
      "./search/vercel",
      "./search/tanstack",
      "./search/cloudflare",
      "./sveltekit",
      "./tanstack-start",
      "./lint",
      "./mcp",
      "./webmcp",
      "./score",
    ] as const;

    expect(exportedPaths).toHaveLength(expectedExportedPaths.length);
    expect(new Set(exportedPaths)).toEqual(new Set(expectedExportedPaths));
  });

  it("does not expose framework-specific runtime UI component adapters", () => {
    // Leadtype ships state primitives (hooks, composables, stores) under
    // framework subpaths but never rendered DOM. The framework subpath itself
    // (./next, ./fumadocs) is allowed; bare `./react`, `./vue`, `./svelte`
    // entries would imply UI components.
    expect(exportedPaths).not.toContain("./react");
    expect(exportedPaths).not.toContain("./vue");
    expect(exportedPaths).not.toContain("./svelte");
    expect(exportedPaths).not.toContain("./solid");
  });

  it("keeps optional TypeScript loading out of the remark entry import path", () => {
    const typeTableSource = readSrc("remark/plugins/type-table.remark.ts");

    expect(typeTableSource).not.toContain('import * as ts from "typescript"');
    expect(typeTableSource).toContain('import type * as ts from "typescript"');
  });

  it("keeps provider answer subpaths free of bash adapters", () => {
    const providerEntryPaths = [
      "search/ai-index.ts",
      "search/cloudflare-index.ts",
      "search/tanstack-index.ts",
      "search/vercel-index.ts",
    ] as const;

    for (const entryPath of providerEntryPaths) {
      const source = readSrc(entryPath);
      expect(source).not.toContain("vercel-bash");
      expect(source).not.toContain("tanstack-bash");
      expect(source).not.toContain("docs-bash");
      expect(source).not.toContain("createDocsBash");
    }
  });
});

describe("core/adapter boundary", () => {
  // Lazily resolved so the test files themselves can be skipped from the scan.
  const srcRoot = fileURLToPath(new URL("../", import.meta.url));

  // Files that hold inert scaffold templates: the framework `import` lines in
  // them are strings we generate into a consumer's app, not imports of the
  // module. Real logic lives elsewhere and stays under the boundary scan.
  const TEMPLATE_PAYLOAD_FILES = new Set(["cli/init-templates.ts"]);

  async function listSourceFiles(): Promise<string[]> {
    const matches = await glob("**/*.ts", {
      cwd: srcRoot,
      onlyFiles: true,
      absolute: true,
    });
    return matches.filter(
      (file) =>
        !(
          file.endsWith(".test.ts") ||
          // Normalize to POSIX so the exclusion matches on Windows too.
          TEMPLATE_PAYLOAD_FILES.has(
            path.relative(srcRoot, file).split(path.sep).join("/")
          )
        )
    );
  }

  function relative(file: string): string {
    return path.relative(srcRoot, file);
  }

  function isAdapterFile(relativePath: string): boolean {
    return ADAPTER_DIRECTORIES.some((dir) => relativePath.startsWith(dir));
  }

  function allowsFrameworkRuntimeImports(relativePath: string): boolean {
    return FRAMEWORK_RUNTIME_DIRECTORIES.some((entry) =>
      entry.endsWith("/")
        ? relativePath.startsWith(entry)
        : relativePath === entry
    );
  }

  it("does not let framework runtimes leak into core modules", async () => {
    const files = await listSourceFiles();
    const violations: Array<{ file: string; specifier: string }> = [];

    for (const file of files) {
      const relativePath = relative(file);
      if (allowsFrameworkRuntimeImports(relativePath)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      for (const specifier of extractImportSpecifiers(source)) {
        for (const banned of FRAMEWORK_RUNTIME_IMPORTS) {
          if (matchesBannedSpecifier(specifier, banned)) {
            violations.push({ file: relativePath, specifier });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps adapter directories from importing each other", async () => {
    const files = await listSourceFiles();
    const violations: Array<{ file: string; specifier: string }> = [];

    for (const file of files) {
      const relativePath = relative(file);
      if (!isAdapterFile(relativePath)) {
        continue;
      }
      const ownDir = ADAPTER_DIRECTORIES.find((dir) =>
        relativePath.startsWith(dir)
      );
      const source = readFileSync(file, "utf8");
      for (const specifier of extractImportSpecifiers(source)) {
        if (!specifier.startsWith(".")) {
          continue;
        }
        // Resolve relative imports to a src-rooted path. Adapter files may
        // only walk into core (`../source`, `../search/search`) — never into
        // a sibling adapter directory.
        const resolved = path
          .relative(srcRoot, path.resolve(path.dirname(file), specifier))
          .replaceAll(path.sep, "/");
        for (const other of ADAPTER_DIRECTORIES) {
          if (other === ownDir) {
            continue;
          }
          if (resolved.startsWith(other) || resolved === other.slice(0, -1)) {
            violations.push({ file: relativePath, specifier });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("declares no framework runtimes in `dependencies`", () => {
    const deps = Object.keys(packageJson.dependencies);
    for (const banned of FRAMEWORK_RUNTIME_IMPORTS) {
      const baseName = banned.replace(/[/$]$/, "");
      expect(deps).not.toContain(baseName);
    }
  });
});
