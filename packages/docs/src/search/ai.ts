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
  streamTextImpl?: StreamTextLike;
};

export type StreamDocsAnswerResult = {
  response: Response;
  sources: DocsAnswerSource[];
};

type DocsTextStreamPart =
  | {
      type: "text-delta";
      text: string;
    }
  | {
      type: "error";
      error: unknown;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

function getStreamErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "The AI provider returned an error while streaming.";
}

function createDocsTextStreamResponse(
  stream: AsyncIterable<DocsTextStreamPart>,
  init: ResponseInit
): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let streamedText = false;
        let streamedFailure = false;
        try {
          for await (const part of stream) {
            if (part.type === "text-delta" && typeof part.text === "string") {
              streamedText = true;
              controller.enqueue(encoder.encode(part.text));
              continue;
            }
            if (part.type === "error") {
              streamedFailure = true;
              controller.enqueue(
                encoder.encode(
                  `AI answer failed: ${getStreamErrorMessage(part.error)}`
                )
              );
              break;
            }
          }
          if (!(streamedText || streamedFailure)) {
            controller.enqueue(
              encoder.encode(
                "AI answer failed: The AI provider returned an empty answer. Check AI Gateway auth and model access."
              )
            );
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(`AI answer failed: ${getStreamErrorMessage(error)}`)
          );
        } finally {
          controller.close();
        }
      },
    }),
    init
  );
}

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
  const responseInit = {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  } as const satisfies ResponseInit;

  return {
    response: result.fullStream
      ? createDocsTextStreamResponse(result.fullStream, responseInit)
      : result.toTextStreamResponse(responseInit),
    sources: context.sources,
  };
}
