import type { Root } from "mdast";
import * as v from "valibot";
import type { DocsSearchChunk, DocsSearchDocument } from "./search/search";

export type DocsFrontmatter = Record<string, unknown>;

/**
 * Valibot object schema used to validate and type resolved page frontmatter.
 * The generic parameter lets `defineDocsConfig`, `createDocsSource`, and
 * transformer payloads carry the schema's output type through the public API.
 */
export type DocsFrontmatterSchema<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = v.ObjectSchema<
  v.ObjectEntries,
  v.ErrorMessage<v.ObjectIssue> | undefined
> & {
  readonly "~types"?: {
    readonly output: TFrontmatter;
  };
};

export type MaybePromise<T> = T | Promise<T>;

export type DocsTransformHook =
  | "beforeParse"
  | "afterFrontmatter"
  | "afterMdxAst"
  | "afterFlattenMarkdown"
  | "beforeSearchIndex"
  | "beforeSearchChunk"
  | "beforeLlmsTxt"
  | "beforeLlmsFull"
  | "beforeAgentsMd";

export type DocsTransformStage = "convert" | "source" | "search" | "llm";

export type DocsTransformContext = {
  /** Name from the current `DocsTransformer`, useful in shared hook helpers. */
  transformerName: string;
  /** Lifecycle hook currently running. */
  hook: DocsTransformHook;
  /** Pipeline stage invoking the hook. */
  stage: DocsTransformStage;
  /** Absolute source file path when the hook operates on one page. */
  filePath?: string;
  /** Source-relative path or generated artifact path, when available. */
  relativePath?: string;
  /** Canonical docs URL path, when available. */
  urlPath?: string;
  /** Active locale for localized generation. */
  locale?: string;
  /** Collection key for multi-source configs, when available. */
  collectionKey?: string;
};

export type DocsRawPage = {
  filePath: string;
  raw: string;
};

export type DocsFrontmatterPage<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = {
  filePath: string;
  content: string;
  frontmatter: string;
  data: TFrontmatter;
};

export type DocsAstPage<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = DocsFrontmatterPage<TFrontmatter> & {
  ast: Root;
};

export type DocsMarkdownPage<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = DocsAstPage<TFrontmatter> & {
  markdown: string;
};

export type DocsSearchChunkInput = Omit<
  DocsSearchChunk,
  "absoluteUrlWithHash" | "documentId" | "id" | "length" | "urlWithHash"
> & {
  documentId?: string;
  id?: string;
  /**
   * Optional for compatibility with the public chunk shape. Leadtype
   * recomputes length from the final text after this hook returns.
   */
  length?: number;
};

export type DocsLlmsTxtArtifact = {
  content: string;
  outputPath: string;
  kind: "root" | "docs";
  locale?: string;
};

export type DocsLlmsFullArtifact = {
  content: string;
  outputPath: string;
  locale?: string;
};

export type DocsAgentsMdArtifact = {
  content: string;
  outputPath: string;
  docsSubdir: string;
  locale?: string;
};

export type DocsTransformer<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = {
  /** Stable name shown in hook failure messages. */
  name: string;
  /** Edit raw source before frontmatter and MDX parsing. */
  beforeParse?: (
    page: DocsRawPage,
    context: DocsTransformContext
  ) => MaybePromise<DocsRawPage | undefined>;
  /** Add, normalize, or validate frontmatter-derived page metadata. */
  afterFrontmatter?: (
    page: DocsFrontmatterPage<TFrontmatter>,
    context: DocsTransformContext
  ) => MaybePromise<DocsFrontmatterPage<TFrontmatter> | undefined>;
  /** Edit the mdast tree after Leadtype's markdown transforms have run. */
  afterMdxAst?: (
    page: DocsAstPage<TFrontmatter>,
    context: DocsTransformContext
  ) => MaybePromise<DocsAstPage<TFrontmatter> | undefined>;
  /** Edit flattened markdown before it is returned, written, or indexed. */
  afterFlattenMarkdown?: (
    page: DocsMarkdownPage<TFrontmatter>,
    context: DocsTransformContext
  ) => MaybePromise<DocsMarkdownPage<TFrontmatter> | undefined>;
  /** Edit the complete search document list before chunking and indexing. */
  beforeSearchIndex?: (
    documents: DocsSearchDocument[],
    context: DocsTransformContext
  ) => MaybePromise<DocsSearchDocument[] | undefined>;
  /** Edit one generated search chunk before term indexing. */
  beforeSearchChunk?: (
    chunk: DocsSearchChunkInput,
    context: DocsTransformContext
  ) => MaybePromise<DocsSearchChunkInput | undefined>;
  /** Edit root or docs-scoped `llms.txt` before write. */
  beforeLlmsTxt?: (
    artifact: DocsLlmsTxtArtifact,
    context: DocsTransformContext
  ) => MaybePromise<DocsLlmsTxtArtifact | undefined>;
  /** Edit `llms-full.txt` before write. */
  beforeLlmsFull?: (
    artifact: DocsLlmsFullArtifact,
    context: DocsTransformContext
  ) => MaybePromise<DocsLlmsFullArtifact | undefined>;
  /** Edit package-bundled `AGENTS.md` before write. */
  beforeAgentsMd?: (
    artifact: DocsAgentsMdArtifact,
    context: DocsTransformContext
  ) => MaybePromise<DocsAgentsMdArtifact | undefined>;
};

export class DocsTransformerError extends Error {
  readonly cause: unknown;

  constructor(context: DocsTransformContext, cause: unknown) {
    let location = "";
    if (context.filePath) {
      location = ` for "${context.filePath}"`;
    } else if (context.relativePath) {
      location = ` for "${context.relativePath}"`;
    }
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Transformer "${context.transformerName}" failed in ${context.hook}${location}: ${reason}`
    );
    this.name = "DocsTransformerError";
    this.cause = cause;
  }
}

export type DocsTransformerOptions<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
> = {
  /** Lifecycle hooks run in array order. */
  transformers?: DocsTransformer<TFrontmatter>[];
  /** Optional schema for resolved frontmatter after transformer hooks. */
  frontmatterSchema?: DocsFrontmatterSchema<TFrontmatter>;
  /** Extra stable context merged into every hook invocation. */
  transformContext?: Partial<
    Omit<DocsTransformContext, "hook" | "transformerName">
  >;
};

function contextFor<TFrontmatter extends DocsFrontmatter>(
  transformer: DocsTransformer<TFrontmatter>,
  hook: DocsTransformHook,
  base: Partial<Omit<DocsTransformContext, "hook" | "transformerName">>
): DocsTransformContext {
  return {
    stage: base.stage ?? "convert",
    ...base,
    transformerName: transformer.name,
    hook,
  };
}

export async function runTransformers<
  THook extends DocsTransformHook,
  TValue,
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  transformers: DocsTransformer<TFrontmatter>[] | undefined,
  hook: THook,
  value: TValue,
  context: Partial<Omit<DocsTransformContext, "hook" | "transformerName">>,
  call: (
    transformer: DocsTransformer<TFrontmatter>,
    value: TValue,
    context: DocsTransformContext
  ) => MaybePromise<TValue | undefined>
): Promise<TValue> {
  let current = value;
  for (const transformer of transformers ?? []) {
    const fn = transformer[hook];
    if (!fn) {
      continue;
    }
    const transformContext = contextFor(transformer, hook, context);
    try {
      const next = await call(transformer, current, transformContext);
      if (next !== undefined) {
        current = next;
      }
    } catch (error) {
      throw new DocsTransformerError(transformContext, error);
    }
  }
  return current;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  const then = (value as { then?: unknown } | null)?.then;
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof then === "function"
  );
}

export function runTransformersSync<
  THook extends DocsTransformHook,
  TValue,
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  transformers: DocsTransformer<TFrontmatter>[] | undefined,
  hook: THook,
  value: TValue,
  context: Partial<Omit<DocsTransformContext, "hook" | "transformerName">>,
  call: (
    transformer: DocsTransformer<TFrontmatter>,
    value: TValue,
    context: DocsTransformContext
  ) => TValue | undefined
): TValue {
  let current = value;
  for (const transformer of transformers ?? []) {
    const fn = transformer[hook];
    if (!fn) {
      continue;
    }
    const transformContext = contextFor(transformer, hook, context);
    try {
      const next = call(transformer, current, transformContext);
      if (isPromiseLike(next)) {
        throw new Error(
          `${hook} returned a Promise in a synchronous pipeline. Use a synchronous transformer for createDocsSearchIndex.`
        );
      }
      if (next !== undefined) {
        current = next;
      }
    } catch (error) {
      throw new DocsTransformerError(transformContext, error);
    }
  }
  return current;
}

export function validateFrontmatter<
  TFrontmatter extends DocsFrontmatter = DocsFrontmatter,
>(
  schema: DocsFrontmatterSchema<TFrontmatter> | undefined,
  data: DocsFrontmatter,
  filePath: string
): TFrontmatter {
  if (!schema) {
    return data as TFrontmatter;
  }
  const result = v.safeParse(schema, data);
  if (result.success) {
    return result.output as TFrontmatter;
  }
  const details = result.issues
    .map((issue) => {
      const path = issue.path?.map((part) => String(part.key)).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
  throw new Error(`Invalid frontmatter in "${filePath}": ${details}`);
}
