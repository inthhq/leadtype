/** @biome-ignore lint/performance/noBarrelFile: package entry point */

export { type Builders, b, parseMarkdown } from "./builders";
// The built-in plugin set, split by phase. `defaultRemarkPlugins` keeps its
// historical order; phase tags handle scheduling when consumers add their own.
export {
  builtinFlattenerPlugins,
  defaultRemarkPlugins,
} from "./default-plugins";
// High-level authoring surface for custom component → markdown flattening.
export {
  type ComponentFlattenerSpec,
  defineComponentFlattener,
  type FlattenContext,
  type FlattenResult,
  type InferProps,
  type PropKind,
  type PropsSpec,
} from "./define-flattener";
// Low-level toolkit — the same building blocks the built-in flatteners use.
// Reach for these when you need full mdast control inside a custom plugin.
export {
  createBlockquote,
  createHeading,
  createInlineCode,
  createJsxComponentProcessor,
  createLink,
  createListItem,
  createOrderedList,
  createParagraph,
  createStrong,
  createStrongParagraph,
  createTable,
  createTableCell,
  createTableRow,
  createText,
  createUnorderedList,
  extractNodeText,
  getAttributeValue,
  hasName,
  type MdxNode,
  normalizeWhitespace,
  parseItemsArray,
  processContentNode,
} from "./libs";
export { remarkInclude } from "./plugins/include.remark";
export {
  extractTypeFromFile,
  remarkTypeTableToMarkdown,
} from "./plugins/type-table.remark";
