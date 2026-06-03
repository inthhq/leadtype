import path from "node:path";
import { fileURLToPath } from "node:url";
import createMDX from "@next/mdx";
import { createMdxSourcePlugins } from "leadtype/mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";

const appDir = path.dirname(fileURLToPath(import.meta.url));
// <ExtractedTypeTable path="..."> is resolved relative to the monorepo root.
const typeTableBasePath = path.resolve(appDir, "../..");

/** Drop the parsed frontmatter node — leadtype's source preset expects bodies. */
function stripYamlFrontmatter() {
  return (tree) => {
    if (Array.isArray(tree.children)) {
      tree.children = tree.children.filter((node) => node.type !== "yaml");
    }
    return tree;
  };
}

// Build-time MDX with leadtype's source preset (expand <include>, resolve
// <ExtractedTypeTable>, strip authoring imports). These are function plugins,
// so the build runs on webpack (`next build --webpack`); the Turbopack-clean
// path for content without source transforms is `["leadtype/mdx/source", …]`.
const withMdx = createMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [
      remarkFrontmatter,
      stripYamlFrontmatter,
      remarkGfm,
      ...createMdxSourcePlugins({ typeTableBasePath }),
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  // The docs `.mdx` live in the repo's /docs, outside the app directory.
  experimental: { externalDir: true },
};

export default withMdx(nextConfig);
