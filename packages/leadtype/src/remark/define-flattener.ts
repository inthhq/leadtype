/**
 * `defineComponentFlattener` — author a custom MDX component → markdown
 * flattener without hand-writing a remark plugin.
 *
 * You provide a component name, an optional prop-coercion map, and a
 * `toMarkdown` function. Leadtype handles the rest: tree visiting, prop
 * parsing, child flattening, and plugin scheduling.
 *
 * The returned plugin is tagged to run in the `custom` phase — after includes
 * and placeholder resolution, before the built-in flatteners — so it composes
 * correctly with `defaultRemarkPlugins` no matter where it's placed in the
 * array. See `internal/remark-phase.ts`.
 */

import type { Root, RootContent } from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import type { Plugin } from "unified";
import type { VFile } from "vfile";
import { logger } from "../internal/logger";
import { tagPhase } from "../internal/remark-phase";
import { type Builders, b } from "./builders";
import { builtinFlattenerPlugins } from "./default-plugins";
import {
  createJsxComponentProcessor,
  getAttributeValue,
  type MdxNode,
  parseItemsArray,
} from "./libs";

export type PropKind = "string" | "number" | "boolean" | "string[]";

/** Declarative coercion map: prop name → runtime type. */
export type PropsSpec = Record<string, PropKind>;

type PropTypeFor<K extends PropKind> = K extends "string"
  ? string
  : K extends "number"
    ? number
    : K extends "boolean"
      ? boolean
      : string[];

/** Infer the typed `props` object from a `PropsSpec` (all keys optional). */
export type InferProps<S> = S extends PropsSpec
  ? { [K in keyof S]?: PropTypeFor<S[K]> }
  : Record<string, string | undefined>;

export interface FlattenContext<TProps> {
  /** Markdown builders: `b.blockquote(...)`, `b.table(...)`, etc. */
  b: Builders;
  /** Children as already-flattened mdast nodes, for block-level composition. */
  childNodes: RootContent[];
  /** Children flattened to a markdown string (built-in components resolved). */
  content: string;
  /** Source file path, for diagnostics. */
  file: string;
  /** The raw mdast JSX node — escape hatch for anything builders can't express. */
  node: MdxNode;
  /** Parsed, coerced props from the component's attributes. */
  props: TProps;
}

/**
 * What `toMarkdown` may return:
 * - `string` — parsed as markdown source into nodes
 * - `RootContent` / `RootContent[]` — mdast nodes inserted as-is
 * - `null` — remove the component entirely
 */
export type FlattenResult = string | RootContent | RootContent[] | null;

export interface ComponentFlattenerSpec<
  S extends PropsSpec | undefined = undefined,
> {
  /** Component name(s) to match, e.g. `"Hint"` or `["Hint", "Tip"]`. */
  name: string | string[];
  /** Optional prop coercion; defaults to raw string attributes. */
  props?: S;
  /** Produce the markdown equivalent of one matched component. */
  toMarkdown: (ctx: FlattenContext<InferProps<S>>) => FlattenResult;
}

type SubProcessor = ReturnType<typeof remark>;

let subProcessor: SubProcessor | null = null;

/**
 * A processor running only the built-in flatteners (no resolve-phase plugins —
 * those already ran on the parent document). Used to flatten a component's
 * children before handing them to `toMarkdown`.
 */
function getSubProcessor(): SubProcessor {
  if (subProcessor) {
    return subProcessor;
  }
  let processor: SubProcessor = remark()
    .use(remarkMdx)
    .use(remarkGfm)
    .data("settings", {
      tableCellPadding: false,
      tablePipeAlign: false,
    } as Record<string, unknown>);
  for (const plugin of builtinFlattenerPlugins) {
    // biome-ignore lint/suspicious/noExplicitAny: unified's .use() overloads are too narrow for a dynamic plugin array
    processor = (processor as any).use(plugin);
  }
  subProcessor = processor;
  return processor;
}

function flattenChildren(node: MdxNode): {
  content: string;
  childNodes: RootContent[];
} {
  const processor = getSubProcessor();
  const root: Root = {
    type: "root",
    children: (node.children ?? []) as RootContent[],
  };
  const transformed = processor.runSync(root) as Root;
  const content = String(processor.stringify(transformed)).trim();
  return { content, childNodes: transformed.children };
}

function coerceValue(raw: string | null, kind: PropKind): unknown {
  if (raw === null) {
    return;
  }
  switch (kind) {
    case "string":
      return raw;
    case "number": {
      // `Number("")` is `0`, but an empty attribute means "not set" — treat it
      // as undefined alongside non-numeric values.
      if (raw === "") {
        return;
      }
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    case "boolean":
      // Bare attributes (`<X open />`) resolve to "true"; `open={false}` and
      // `open="false"` resolve to "false". Anything else is truthy.
      return raw !== "false";
    default:
      return parseItemsArray(raw) ?? undefined;
  }
}

function coerceProps<S extends PropsSpec | undefined>(
  node: MdxNode,
  spec: S
): InferProps<S> {
  if (!spec) {
    const raw: Record<string, string> = {};
    for (const attr of node.attributes ?? []) {
      if (attr.type === "mdxJsxAttribute" && typeof attr.name === "string") {
        const value = getAttributeValue(node, attr.name);
        if (value !== null) {
          raw[attr.name] = value;
        }
      }
    }
    return raw as InferProps<S>;
  }
  const out: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(spec)) {
    out[key] = coerceValue(getAttributeValue(node, key), kind);
  }
  return out as InferProps<S>;
}

function normalizeResult(result: FlattenResult): RootContent[] {
  if (result === null) {
    return [];
  }
  if (typeof result === "string") {
    return b.md(result);
  }
  return Array.isArray(result) ? result : [result];
}

/**
 * Define a remark plugin that flattens a custom MDX component into markdown.
 *
 * @example
 * ```ts
 * const hint = defineComponentFlattener({
 *   name: "Hint",
 *   props: { title: "string" },
 *   toMarkdown: ({ props, content, b }) =>
 *     b.blockquote([b.strong(props.title ?? "Hint"), content]),
 * });
 *
 * // leadtype.config.ts
 * remarkPlugins: [...defaultRemarkPlugins, hint];
 * ```
 */
export function defineComponentFlattener<
  const S extends PropsSpec | undefined = undefined,
>(spec: ComponentFlattenerSpec<S>): Plugin<[], Root> {
  const names = Array.isArray(spec.name) ? spec.name : [spec.name];

  const plugin: Plugin<[], Root> = () =>
    createJsxComponentProcessor(
      names,
      (node: MdxNode, _index: number, _parent, file?: VFile) => {
        try {
          const props = coerceProps(node, spec.props) as InferProps<S>;
          const { content, childNodes } = flattenChildren(node);
          const result = spec.toMarkdown({
            props,
            content,
            childNodes,
            b,
            node,
            file: file?.path ?? "",
          });
          return normalizeResult(result);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          logger.error({
            human: {
              message: `defineComponentFlattener(${names.join("|")}) failed in ${file?.path ?? "<unknown>"}: ${reason}`,
              hint: "the raw component was left in place; check the toMarkdown implementation",
            },
            json: {
              event: "flattener.fail",
              fields: { names, file: file?.path ?? null, reason },
            },
          });
          // Returning undefined leaves the original node untouched.
          return;
        }
      }
    );

  tagPhase(plugin, "custom");
  return plugin;
}
