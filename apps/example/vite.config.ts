import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import type { Root } from "mdast";
import { nitro } from "nitro/vite";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { defineConfig, type PluginOption, searchForWorkspaceRoot } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

function stripYamlFrontmatter() {
  return (tree: Root) => {
    if (!tree.children) {
      return tree;
    }

    tree.children = tree.children.filter((node) => node.type !== "yaml");
    return tree;
  };
}

const MARKDOWN_ACCEPT_PATTERN = /text\/(markdown|plain)/i;
const HTML_ACCEPT_PATTERN = /text\/html/i;
const MARKDOWN_Q_PATTERN = /text\/(markdown|plain)\s*;?\s*q=/i;
const TRAILING_SLASH_PATTERN = /\/$/;

function rewriteToMarkdown(
  url: string,
  accept: string | undefined
): string | null {
  if (!accept) {
    return null;
  }
  const pathname = url.split("?")[0] ?? url;
  if (pathname.endsWith(".md")) {
    return null;
  }
  if (!(pathname === "/docs" || pathname.startsWith("/docs/"))) {
    return null;
  }
  if (!MARKDOWN_ACCEPT_PATTERN.test(accept)) {
    return null;
  }
  if (HTML_ACCEPT_PATTERN.test(accept) && !MARKDOWN_Q_PATTERN.test(accept)) {
    // Browsers send `text/html,application/xhtml+xml,...` — never serve markdown to them.
    return null;
  }
  const target =
    pathname === "/docs"
      ? "/docs/index.md"
      : `${pathname.replace(TRAILING_SLASH_PATTERN, "")}.md`;
  return (
    target + (url.length > pathname.length ? url.slice(pathname.length) : "")
  );
}

function markdownNegotiation(): PluginOption {
  const middleware = (
    req: {
      url?: string;
      headers: Record<string, string | string[] | undefined>;
    },
    _res: unknown,
    next: () => void
  ) => {
    if (!req.url) {
      next();
      return;
    }
    const acceptHeader = req.headers.accept;
    const accept = Array.isArray(acceptHeader)
      ? acceptHeader.join(",")
      : acceptHeader;
    const rewritten = rewriteToMarkdown(req.url, accept);
    if (rewritten) {
      req.url = rewritten;
    }
    next();
  };
  return {
    name: "leadtype:markdown-negotiation",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  server: {
    allowedHosts: [".localhost"],
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
  plugins: [
    markdownNegotiation(),
    nitro(),
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    {
      ...mdx({
        providerImportSource: "@mdx-js/react",
        remarkPlugins: [remarkFrontmatter, remarkGfm, stripYamlFrontmatter],
      }),
      enforce: "pre",
    },
    tanstackStart(),
    viteReact({
      include: /\.(mdx|[jt]sx?)$/,
    }),
  ],
});
