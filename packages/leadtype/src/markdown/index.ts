/** @biome-ignore lint/performance/noBarrelFile: package entry point */

export { remarkInclude as includeMarkdown } from "../remark/plugins/include.remark";
export { type Builders, b, parseMarkdown } from "./builders";
export {
  type NativeMarkdownDispatcherOptions,
  nativeMarkdownComponentsToMarkdown,
} from "./component-dispatcher";
export {
  BUILTIN_FLATTENER_COMPONENT_NAMES,
  builtinMarkdownFlattenerTransforms,
  defaultMarkdownTransforms,
} from "./default-transforms";
export {
  type ComponentFlattenerSpec,
  defineComponentFlattener,
  type FlattenContext,
  type FlattenResult,
  type InferProps,
  type PropKind,
  type PropsSpec,
} from "./define-flattener";
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
export {
  extractTypeFromFile,
  remarkTypeTableToMarkdown,
} from "./plugins/type-table";
export { stringifyMarkdown } from "./stringify";
export {
  createMdastTransforms,
  type LeadtypeMdastTransform,
  type LeadtypeMdastTransformContext,
  runMdastTransforms,
  runMdastTransformsSync,
} from "./transform";
