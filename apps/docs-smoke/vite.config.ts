import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import remarkFrontmatter from "remark-frontmatter";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

function stripYamlFrontmatter() {
  return (tree: { children?: Array<{ type?: string }> }) => {
    if (!tree.children) {
      return tree;
    }

    tree.children = tree.children.filter((node) => node.type !== "yaml");
    return tree;
  };
}

export default defineConfig({
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
  plugins: [
    nitro(),
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    {
      ...mdx({
        providerImportSource: "@mdx-js/react",
        remarkPlugins: [remarkFrontmatter, stripYamlFrontmatter],
      }),
      enforce: "pre",
    },
    tanstackStart(),
    viteReact({
      include: /\.(mdx|[jt]sx?)$/,
    }),
  ],
});
