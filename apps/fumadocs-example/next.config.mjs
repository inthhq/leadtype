import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import createMDX from "@next/mdx";
import { rehypeCode } from "fumadocs-core/mdx-plugins";
import { createMdxSourcePlugins } from "leadtype/mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";

const appDir = dirname(fileURLToPath(import.meta.url));
const typeTableBasePath = resolve(appDir, "../..");

const withMDX = createMDX({
  options: {
    // Frontmatter parsing must precede leadtype's stack (it expects bodies).
    remarkPlugins: [
      remarkFrontmatter,
      remarkGfm,
      ...createMdxSourcePlugins({ typeTableBasePath }),
    ],
    // Shiki-based highlighter from fumadocs-core. Pairs with fumadocs-ui's
    // codeblock CSS so tokens, copy button, and frame styling all kick in.
    rehypePlugins: [rehypeCode],
  },
});

/** @type {import("next").NextConfig} */
const config = {
  pageExtensions: ["ts", "tsx", "mdx"],
  // The root Leadtype docs live outside this app package.
  // Next + Turbopack would otherwise reject imports outside the app root.
  experimental: {
    externalDir: true,
  },
};

export default withMDX(config);
