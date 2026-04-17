import { readFile } from "node:fs/promises";
import GithubSlugger from "github-slugger";
import type { Heading, InlineCode, Root, Text } from "mdast";
import { remark } from "remark";
import remarkMdx from "remark-mdx";
import { visit } from "unist-util-visit";

export interface TOCItem {
  depth: number;
  title: string;
  url: string;
}

/**
 * Extract text content from a heading node
 * Collects both regular text and inline code content
 */
function extractHeadingText(node: Heading): string {
  const textParts: string[] = [];

  // Visit both 'text' and 'inlineCode' nodes to capture full heading content
  visit(node, (childNode) => {
    if (childNode.type === "text" || childNode.type === "inlineCode") {
      textParts.push((childNode as Text | InlineCode).value);
    }
  });

  return textParts.join("");
}

/**
 * Extract TOC items from MDX AST.
 * Uses GithubSlugger (same as rehype-slug) to ensure IDs match rendered headings.
 */
function extractTocFromAst(tree: Root): TOCItem[] {
  const toc: TOCItem[] = [];
  // Use GithubSlugger for consistent ID generation with rehype-slug
  const slugger = new GithubSlugger();

  visit(tree, "heading", (node: Heading) => {
    // Only include h2-h4 headings (skip h1 as it's usually the title)
    if (node.depth >= 2 && node.depth <= 4) {
      const text = extractHeadingText(node);
      if (text) {
        toc.push({
          title: text,
          url: `#${slugger.slug(text)}`,
          depth: node.depth,
        });
      }
    }
  });

  return toc;
}

/**
 * Extract TOC from MDX content string
 */
export async function extractTocFromContent(
  content: string
): Promise<TOCItem[]> {
  const processor = remark().use(remarkMdx);
  const tree = processor.parse(content);
  return extractTocFromAst(tree as Root);
}

/**
 * Extract TOC from an MDX file path.
 */
export async function extractTocFromFile(filePath: string): Promise<TOCItem[]> {
  const content = await readFile(filePath, "utf-8");
  // Remove frontmatter before parsing
  const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---\n/, "");
  return extractTocFromContent(contentWithoutFrontmatter);
}
