import {
  type AnyTextAdapter,
  chat,
  type StreamChunk,
  type Tool,
} from "@tanstack/ai";
import { createDocsTextStreamResponse } from "./answer-stream";
import {
  type AnswerContextOptions,
  createAnswerContext,
  type DocsAnswerSource,
  type DocsSearchContentStore,
  type DocsSearchIndex,
  docsSearchDefaults,
} from "./search";

const DEFAULT_MAX_TOKENS = 700;

type ChatOptions = Parameters<typeof chat>[0];
type ChatLike = (options: ChatOptions) => AsyncIterable<StreamChunk>;

export type TanStackModelOptions = Record<string, unknown>;

export type StreamDocsAnswerOptions = {
  index: DocsSearchIndex;
  content?: DocsSearchContentStore;
  query: string;
  adapter: AnyTextAdapter;
  productName?: string;
  searchOptions?: AnswerContextOptions;
  maxTokens?: number;
  modelOptions?: TanStackModelOptions;
  abortController?: AbortController;
  tools?: Tool[];
  toolInstructions?: string;
  chatImpl?: ChatLike;
};

export type StreamDocsAnswerResult = {
  response: Response;
  sources: DocsAnswerSource[];
};

function appendToolInstructions(
  system: string,
  toolInstructions?: string
): string {
  return toolInstructions ? `${system} ${toolInstructions}` : system;
}

function getChunkText(part: StreamChunk): string | undefined {
  if (part.type === "TEXT_MESSAGE_CONTENT" && "delta" in part) {
    return typeof part.delta === "string" ? part.delta : undefined;
  }
  return;
}

function getChunkError(part: StreamChunk): unknown {
  if (part.type !== "RUN_ERROR") {
    return;
  }
  if ("message" in part && part.message) {
    return part.message;
  }
  if ("error" in part && part.error) {
    return part.error;
  }
  return "The AI provider returned an error while streaming.";
}

function getChunkFinishReason(part: StreamChunk): string | undefined {
  return part.type === "RUN_FINISHED" && "finishReason" in part
    ? (part.finishReason ?? undefined)
    : undefined;
}

function isReasoningChunk(part: StreamChunk): boolean {
  return part.type === "REASONING_MESSAGE_CONTENT";
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
  const runChat = options.chatImpl ?? chat;
  const stream = runChat({
    adapter: options.adapter,
    abortController: options.abortController,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [{ role: "user", content: context.prompt }],
    modelOptions: options.modelOptions,
    stream: true,
    systemPrompts: [
      appendToolInstructions(context.system, options.toolInstructions),
    ],
    tools: options.tools,
  } as ChatOptions) as AsyncIterable<StreamChunk>;

  return {
    response: createDocsTextStreamResponse(stream, {
      getError: getChunkError,
      getFinishReason: getChunkFinishReason,
      getText: getChunkText,
      isReasoning: isReasoningChunk,
    }),
    sources: context.sources,
  };
}
