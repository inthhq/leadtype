#!/usr/bin/env bun

import { join } from "node:path";
import { convertMdxToMarkdown } from "@inth/docs/convert";
import {
  defaultRemarkPlugins,
  remarkTypeTableToMarkdown,
} from "@inth/docs/remark";

const appRoot = process.cwd();
const repoRoot = join(appRoot, "..", "..");
const fixturePath = join(
  appRoot,
  "content",
  "docs",
  "guides",
  "extracted-type-table-fixture.mdx"
);
type RemarkPlugins = NonNullable<Parameters<typeof convertMdxToMarkdown>[1]>;

const typeTableRemarkPlugin: RemarkPlugins[number] = [
  remarkTypeTableToMarkdown,
  { basePath: repoRoot },
];
const remarkPlugins: RemarkPlugins = [
  ...defaultRemarkPlugins.filter(
    (plugin) => plugin !== remarkTypeTableToMarkdown
  ),
  typeTableRemarkPlugin,
];

const result = await convertMdxToMarkdown(fixturePath, remarkPlugins);

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
