import {
  type AnthropicChatModel,
  type AnthropicGatewayConfig,
  createAnthropicChat,
  createGeminiChat,
  createGrokChat,
  createOpenAiChat,
  createOpenRouterChat,
  createWorkersAiChat,
  type GeminiChatModel,
  type GeminiGatewayConfig,
  type GrokChatModel,
  type GrokGatewayConfig,
  type OpenAIChatModel,
  type OpenAiGatewayConfig,
  type OpenRouterChatModel,
  type OpenRouterGatewayConfig,
  type WorkersAiAdapterConfig,
  type WorkersAiTextModel,
} from "@cloudflare/tanstack-ai";
import type { AnyTextAdapter } from "@tanstack/ai";

export type CloudflareDocsProvider =
  | "anthropic"
  | "gemini"
  | "grok"
  | "openai"
  | "openrouter"
  | "workers-ai";

export type CreateCloudflareDocsAdapterOptions =
  | {
      provider: "anthropic";
      model: AnthropicChatModel;
      options: AnthropicGatewayConfig;
    }
  | {
      provider: "gemini";
      model: GeminiChatModel;
      options: GeminiGatewayConfig;
    }
  | {
      provider: "grok";
      model: GrokChatModel;
      options: GrokGatewayConfig;
    }
  | {
      provider: "openai";
      model: OpenAIChatModel;
      options: OpenAiGatewayConfig;
    }
  | {
      provider: "openrouter";
      model: OpenRouterChatModel;
      options: OpenRouterGatewayConfig;
    }
  | {
      provider: "workers-ai";
      model: WorkersAiTextModel;
      options: WorkersAiAdapterConfig;
    };

export type StreamDocsAnswerOptions =
  import("./tanstack").StreamDocsAnswerOptions;
export type StreamDocsAnswerResult =
  import("./tanstack").StreamDocsAnswerResult;

function unsupportedCloudflareProvider(options: never): never {
  const provider = (options as { provider?: unknown }).provider;
  throw new Error(`Unsupported Cloudflare docs provider: ${String(provider)}`);
}

export function createCloudflareDocsAdapter(
  options: CreateCloudflareDocsAdapterOptions
): AnyTextAdapter {
  switch (options.provider) {
    case "anthropic":
      return createAnthropicChat(options.model, options.options);
    case "gemini":
      return createGeminiChat(options.model, options.options);
    case "grok":
      return createGrokChat(options.model, options.options);
    case "openai":
      return createOpenAiChat(options.model, options.options);
    case "openrouter":
      return createOpenRouterChat(options.model, options.options);
    case "workers-ai":
      return createWorkersAiChat(options.model, options.options);
    default:
      return unsupportedCloudflareProvider(options);
  }
}

export { streamDocsAnswer } from "./tanstack";
