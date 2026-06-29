#!/usr/bin/env bun

import { join } from "node:path";
import { convertMdxToMarkdown } from "leadtype/convert";
import {
  defaultMarkdownTransforms,
  nativeMarkdownComponentsToMarkdown,
} from "leadtype/markdown";

const appRoot = process.cwd();
const repoRoot = join(appRoot, "..", "..");
const fixturePath = join(
  appRoot,
  "content",
  "docs",
  "guides",
  "extracted-type-table-fixture.mdx"
);
type MarkdownTransforms = NonNullable<
  Parameters<typeof convertMdxToMarkdown>[1]
>;

const typeTableMarkdownTransform: MarkdownTransforms[number] = [
  nativeMarkdownComponentsToMarkdown,
  { typeTable: { basePath: repoRoot } },
];
const markdownTransforms: MarkdownTransforms = [
  ...defaultMarkdownTransforms.filter(
    (plugin) => plugin !== nativeMarkdownComponentsToMarkdown
  ),
  typeTableMarkdownTransform,
];

const result = await convertMdxToMarkdown(fixturePath, markdownTransforms);

if (
  !(
    result.markdown.includes("|value|") &&
    result.markdown.includes("|label|") &&
    result.markdown.includes("|featured|")
  )
) {
  process.stderr.write(result.markdown);
  process.stderr.write(
    "\nFAIL: expected ExtractedTypeTable fixture to resolve PipelineExampleOptions into markdown rows.\n"
  );
  process.exit(1);
}

process.stdout.write("Pipeline fixture passed.\n");
