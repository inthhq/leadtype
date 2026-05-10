import {
  type LanguageModel,
  streamText,
  type TimeoutConfiguration,
  type ToolSet,
} from "ai";
import { logger } from "../internal/logger";
import {
  appendToolInstructions,
  createDocsTextStreamResponse,
  getPlainTextResponseInit,
  getStreamErrorMessage,
} from "./answer-stream";
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

type DocsTextStreamPart =
  | {
      type: "text-delta";
      text: string;
    }
  | {
      type: "reasoning-delta";
    }
  | {
      type: "error";
      error: unknown;
    }
  | {
      type: "finish";
      finishReason?: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

type StreamTextLike = (options: {
  model: LanguageModel;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  timeout: TimeoutConfiguration;
  providerOptions?: DocsProviderOptions;
  tools?: ToolSet;
  onError: (event: { error: unknown }) => void;
}) => {
  fullStream?: AsyncIterable<DocsTextStreamPart>;
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
  tools?: ToolSet;
  toolInstructions?: string;
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
    system: appendToolInstructions(context.system, options.toolInstructions),
    prompt: context.prompt,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    providerOptions: options.providerOptions,
    tools: options.tools,
    onError: ({ error }) => {
      const reason = getStreamErrorMessage(error);
      logger.error({
        human: { message: `streamDocsAnswer provider error: ${reason}` },
        json: {
          event: "search.stream_provider_error",
          fields: { reason },
        },
      });
    },
  });
  const responseInit = getPlainTextResponseInit();

  return {
    response: result.fullStream
      ? createDocsTextStreamResponse(result.fullStream, {
          getError: (part) => (part.type === "error" ? part.error : undefined),
          getFinishReason: (part) =>
            part.type === "finish" && typeof part.finishReason === "string"
              ? part.finishReason
              : undefined,
          getText: (part) =>
            part.type === "text-delta" && typeof part.text === "string"
              ? part.text
              : undefined,
          isReasoning: (part) => part.type === "reasoning-delta",
        })
      : result.toTextStreamResponse(responseInit),
    sources: context.sources,
  };
}
