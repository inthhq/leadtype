import type { WorkersAiTextModel } from "@cloudflare/tanstack-ai";
import type { AnyTextAdapter } from "@tanstack/ai";
import { createAnthropicChat } from "@tanstack/ai-anthropic";
import { createGeminiChat } from "@tanstack/ai-gemini";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import {
  DocsSearchRequestError,
  docsSearchDefaults,
  getClientIdentifier,
  readJsonWithLimit,
  validateDocsQuery,
} from "leadtype/search";
import {
  createCloudflareDocsAdapter,
  streamDocsAnswer as streamCloudflareDocsAnswer,
} from "leadtype/search/cloudflare";
import { streamDocsAnswer as streamTanStackDocsAnswer } from "leadtype/search/tanstack";
import { streamDocsAnswer as streamVercelDocsAnswer } from "leadtype/search/vercel";
import {
  type DemoProviderId,
  type ProviderAnswerConfig,
  providerSearchConfigs,
} from "@/lib/provider-search";
import {
  docsSearchContent,
  docsSearchIndex,
  docsSearchLimiters,
  isAiAnswerEnabled,
  jsonResponse,
} from "@/lib/search";

const VERCEL_DEFAULT_MODEL = "openai/gpt-5.4";
const TANSTACK_DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-5",
  gemini: "gemini-2.0-flash",
  openai: "gpt-4o-mini",
  openrouter: "openai/gpt-4o-mini",
} as const;
const CLOUDFLARE_DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DEFAULT_MAX_OUTPUT_TOKENS = 2000;
const DEFAULT_TIMEOUT = {
  chunkMs: 15_000,
  totalMs: 45_000,
} as const;

interface ProviderAnswerBody {
  query?: unknown;
}

interface CloudflareWorkersAiOptions {
  accountId: string;
  apiKey: string;
}

function getProviderModel(provider: DemoProviderId): string {
  if (provider === "vercel") {
    return process.env.DOCS_SEARCH_MODEL ?? VERCEL_DEFAULT_MODEL;
  }
  if (provider === "tanstack") {
    return getTanStackProviderConfig().model;
  }
  return process.env.CLOUDFLARE_DOCS_SEARCH_MODEL ?? CLOUDFLARE_DEFAULT_MODEL;
}

function getTanStackProviderConfig():
  | {
      apiKey: string;
      model: string;
      provider: "anthropic" | "gemini" | "openai" | "openrouter";
    }
  | {
      model: string;
      provider: "openrouter";
    } {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      model:
        process.env.TANSTACK_DOCS_SEARCH_MODEL ??
        TANSTACK_DEFAULT_MODELS.openrouter,
      provider: "openrouter",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      model:
        process.env.TANSTACK_DOCS_SEARCH_MODEL ??
        TANSTACK_DEFAULT_MODELS.openai,
      provider: "openai",
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model:
        process.env.TANSTACK_DOCS_SEARCH_MODEL ??
        TANSTACK_DEFAULT_MODELS.anthropic,
      provider: "anthropic",
    };
  }
  if (process.env.GEMINI_API_KEY) {
    return {
      apiKey: process.env.GEMINI_API_KEY,
      model:
        process.env.TANSTACK_DOCS_SEARCH_MODEL ??
        TANSTACK_DEFAULT_MODELS.gemini,
      provider: "gemini",
    };
  }

  return {
    model:
      process.env.TANSTACK_DOCS_SEARCH_MODEL ??
      TANSTACK_DEFAULT_MODELS.openrouter,
    provider: "openrouter",
  };
}

function getCloudflareWorkersAiOptions():
  | CloudflareWorkersAiOptions
  | undefined {
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
  const apiKey =
    process.env.CLOUDFLARE_API_TOKEN ??
    process.env.CLOUDFLARE_AI_API_TOKEN ??
    process.env.CF_API_TOKEN;

  if (accountId && apiKey) {
    return {
      accountId,
      apiKey,
    };
  }

  return;
}

function isLiveEnabled(provider: DemoProviderId): boolean {
  if (provider === "vercel") {
    return isAiAnswerEnabled();
  }
  if (provider === "tanstack") {
    return "apiKey" in getTanStackProviderConfig();
  }
  return getCloudflareWorkersAiOptions() !== undefined;
}

export function getProviderAnswerConfig(
  provider: DemoProviderId
): ProviderAnswerConfig {
  const config = providerSearchConfigs[provider];
  const enabled = isLiveEnabled(provider);
  return {
    enabled,
    env: config.env.map((requirement) => ({
      ...requirement,
      configured: requirement.keys.some((key) => Boolean(process.env[key])),
    })),
    label: config.label,
    model: getProviderModel(provider),
    provider,
    wrapper: config.wrapper,
  };
}

function createLiveTanStackAdapter(): AnyTextAdapter {
  const config = getTanStackProviderConfig();
  if (!("apiKey" in config)) {
    throw new Error("TanStack AI provider credentials are not configured.");
  }

  switch (config.provider) {
    case "anthropic":
      return createAnthropicChat(
        config.model as Parameters<typeof createAnthropicChat>[0],
        config.apiKey
      ) as unknown as AnyTextAdapter;
    case "gemini":
      return createGeminiChat(
        config.model as Parameters<typeof createGeminiChat>[0],
        config.apiKey
      ) as unknown as AnyTextAdapter;
    case "openai":
      return createOpenaiChat(
        config.model as Parameters<typeof createOpenaiChat>[0],
        config.apiKey
      ) as unknown as AnyTextAdapter;
    case "openrouter":
      return createOpenRouterText(
        config.model as Parameters<typeof createOpenRouterText>[0],
        config.apiKey
      ) as unknown as AnyTextAdapter;
    default:
      throw new Error("Unsupported TanStack AI provider.");
  }
}

function createLiveCloudflareAdapter(): AnyTextAdapter {
  const options = getCloudflareWorkersAiOptions();
  if (!options) {
    throw new Error("Cloudflare Workers AI credentials are not configured.");
  }
  const model = getCloudflareWorkersAiModel();

  return createCloudflareDocsAdapter({
    model,
    options,
    provider: "workers-ai",
  });
}

function getCloudflareWorkersAiModel(): WorkersAiTextModel {
  const model = getProviderModel("cloudflare");
  if (!model.startsWith("@cf/")) {
    throw new Error(
      `Cloudflare Workers AI model must start with "@cf/". Received "${model}".`
    );
  }
  return model;
}

function streamProviderAnswer(provider: DemoProviderId, query: string) {
  if (provider === "vercel") {
    return streamVercelDocsAnswer({
      content: docsSearchContent,
      index: docsSearchIndex,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      model: getProviderModel(provider),
      productName: "leadtype",
      query,
      timeout: DEFAULT_TIMEOUT,
    });
  }

  if (provider === "tanstack") {
    return streamTanStackDocsAnswer({
      adapter: createLiveTanStackAdapter(),
      content: docsSearchContent,
      index: docsSearchIndex,
      maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      productName: "leadtype",
      query,
    });
  }

  const adapter = createLiveCloudflareAdapter();

  return streamCloudflareDocsAnswer({
    adapter,
    content: docsSearchContent,
    index: docsSearchIndex,
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    productName: "leadtype",
    query,
  });
}

export async function handleProviderAnswerRequest(
  provider: DemoProviderId,
  request: Request
): Promise<Response> {
  try {
    const rateLimit = await docsSearchLimiters.ask.check(
      `ask:${provider}:${getClientIdentifier(request)}`
    );

    if (!rateLimit.allowed) {
      return jsonResponse(
        { error: "Too many answer requests. Try again shortly." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil(
              (rateLimit.resetAt - Date.now()) / 1000
            ).toString(),
          },
        }
      );
    }

    const body = await readJsonWithLimit<ProviderAnswerBody>(request, {
      maxBytes: docsSearchDefaults.maxBodyBytes,
    });
    const query = validateDocsQuery(body.query, {
      fieldName: "query",
      maxChars: docsSearchDefaults.askMaxQueryChars,
    });

    if (!isLiveEnabled(provider)) {
      return jsonResponse(
        {
          error: `${providerSearchConfigs[provider].label} provider credentials are not configured.`,
        },
        { status: 503 }
      );
    }

    const result = streamProviderAnswer(provider, query);

    result.response.headers.set("X-Leadtype-Provider", provider);
    return result.response;
  } catch (error) {
    if (error instanceof DocsSearchRequestError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    return jsonResponse(
      { error: "Provider answer generation failed." },
      { status: 500 }
    );
  }
}
