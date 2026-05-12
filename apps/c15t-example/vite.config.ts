import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mdx from "@mdx-js/rollup";
import viteReact from "@vitejs/plugin-react";
import { remarkInclude } from "leadtype/remark";
import type { Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const appRoot = dirname(fileURLToPath(import.meta.url));

function stripYamlFrontmatter() {
  return (tree: Root) => {
    if (!tree.children) {
      return tree;
    }
    tree.children = tree.children.filter((node) => node.type !== "yaml");
    return tree;
  };
}

export default defineConfig({
  resolve: {
    alias: {
      react: join(appRoot, "node_modules", "react"),
      "react-dom": join(appRoot, "node_modules", "react-dom"),
      "react/jsx-dev-runtime": join(
        appRoot,
        "node_modules",
        "react",
        "jsx-dev-runtime.js"
      ),
      "react/jsx-runtime": join(
        appRoot,
        "node_modules",
        "react",
        "jsx-runtime.js"
      ),
    },
  },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
  plugins: [
    viteTsConfigPaths({ projects: ["./tsconfig.json"] }),
    {
      ...mdx({
        providerImportSource: "@mdx-js/react",
        remarkPlugins: [
          remarkFrontmatter,
          remarkGfm,
          remarkInclude,
          stripYamlFrontmatter,
        ],
      }),
      enforce: "pre",
    },
    viteReact({
      include: /\.(mdx|[jt]sx?)$/,
    }),
  ],
});
