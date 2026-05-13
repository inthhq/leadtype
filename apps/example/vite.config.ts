import { resolve } from "node:path";
import mdx from "@mdx-js/rollup";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { createMdxSourcePlugins } from "leadtype/mdx";
import type { Root } from "mdast";
import { nitro } from "nitro/vite";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const typeTableBasePath = resolve(process.cwd(), "..", "..");

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
  server: {
    allowedHosts: [".localhost"],
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
  plugins: [
    nitro({ serverDir: "./server" }),
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    {
      ...mdx({
        providerImportSource: "@mdx-js/react",
        remarkPlugins: [
          // Frontmatter parsing first (Leadtype's source preset expects bodies only).
          remarkFrontmatter,
          stripYamlFrontmatter,
          remarkGfm,
          // Leadtype's MDX-source preset: expand <include>, resolve
          // <ExtractedTypeTable>, strip authoring `import`s. Keeps every
          // other custom tag as live JSX for the React components below.
          ...createMdxSourcePlugins({ typeTableBasePath }),
        ],
      }),
      enforce: "pre",
    },
    tanstackStart(),
    viteReact({
      include: /\.(mdx|[jt]sx?)$/,
    }),
  ],
});
