import path from "node:path";
import { fileURLToPath } from "node:url";
import createMDX from "@next/mdx";

const appDir = path.dirname(fileURLToPath(import.meta.url));
// <ExtractedTypeTable path="..."> is resolved relative to the synced source.
const typeTableBasePath = path.resolve(appDir, ".leadtype");
const stripYamlFrontmatter = path.join(appDir, "remark-strip-yaml.mjs");

// Build-time MDX with leadtype's source preset. Use string plugin specifiers so
// Next/Turbopack can serialize loader options across worker boundaries.
const withMdx = createMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [
      "remark-frontmatter",
      stripYamlFrontmatter,
      "remark-gfm",
      ["leadtype/mdx/source", { typeTableBasePath }],
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  // The docs `.mdx` live in the synced source checkout.
  experimental: { externalDir: true },
};

export default withMdx(nextConfig);
