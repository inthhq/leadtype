import createMDX from "@next/mdx";
import { rehypeCode } from "fumadocs-core/mdx-plugins";
import { mdxSourcePlugins } from "leadtype/mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";

const withMDX = createMDX({
  options: {
    // Frontmatter parsing must precede leadtype's stack (it expects bodies).
    remarkPlugins: [remarkFrontmatter, remarkGfm, ...mdxSourcePlugins],
    // Shiki-based highlighter from fumadocs-core. Pairs with fumadocs-ui's
    // codeblock CSS so tokens, copy button, and frame styling all kick in.
    rehypePlugins: [rehypeCode],
  },
});

/** @type {import("next").NextConfig} */
const config = {
  pageExtensions: ["ts", "tsx", "mdx"],
  // c15t source lives outside the workspace package boundary at .docs-src/.
  // Next + Turbopack would otherwise reject imports outside the app root.
  experimental: {
    externalDir: true,
  },
};

export default withMDX(config);
