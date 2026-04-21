import { type LanguageModel, streamText, type TimeoutConfiguration } from "ai";
import {
  type AnswerContextOptions,
  createAnswerContext,
  type DocsAnswerSource,
  type DocsSearchContentStore,
  type DocsSearchIndex,
  docsSearchDefaults,
} from "./search";

const DEFAULT_MODEL = "openai/gpt-5.4-mini";
const DEFAULT_MAX_OUTPUT_TOKENS = 700;
const DEFAULT_TIMEOUT = {
  totalMs: 25_000,
  chunkMs: 10_000,
} as const satisfies TimeoutConfiguration;

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type DocsProviderOptions = Record<string, { [key: string]: JsonValue }>;

type StreamTextLike = (options: {
  model: LanguageModel;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  timeout: TimeoutConfiguration;
  providerOptions?: DocsProviderOptions;
  onError: (event: { error: unknown }) => void;
}) => {
  toTextStreamResponse: (init?: ResponseInit) => Response;
};

export type StreamDocsAnswerOptions = {
  index: DocsSearchIndex;
  content?: DocsSearchContentStore;
  query: string;
  model?: LanguageModel | string;
  productName?: string;
  searchOptions?: AnswerContextOptions;
  maxOutputTokens?: number;
  timeout?: TimeoutConfiguration;
  providerOptions?: DocsProviderOptions;
  streamTextImpl?: StreamTextLike;
};

export type StreamDocsAnswerResult = {
  response: Response;
  sources: DocsAnswerSource[];
};

export function streamDocsAnswer(
  options: StreamDocsAnswerOptions
): StreamDocsAnswerResult {
  const context = createAnswerContext(options.index, options.query, {
    content: options.content,
    maxContextChars: docsSearchDefaults.maxContextChars,
    maxSources: docsSearchDefaults.maxSources,
    productName: options.productName,
    ...options.searchOptions,
  });
  const runStreamText = options.streamTextImpl ?? streamText;
  const result = runStreamText({
    model: (options.model ?? DEFAULT_MODEL) as LanguageModel,
    system: context.system,
    prompt: context.prompt,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    providerOptions: options.providerOptions,
    onError: () => undefined,
  });

  return {
    response: result.toTextStreamResponse({
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    }),
    sources: context.sources,
  };
}
