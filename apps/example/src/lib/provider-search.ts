export const providerIds = ["vercel", "tanstack", "cloudflare"] as const;

export type DemoProviderId = (typeof providerIds)[number];

export interface ProviderSearchConfig {
  description: string;
  docsPath: string;
  env: ProviderEnvironmentRequirement[];
  id: DemoProviderId;
  label: string;
  wrapper: string;
}

export interface ProviderEnvironmentRequirement {
  keys: string[];
  label: string;
}

export const providerSearchConfigs = {
  cloudflare: {
    description: "Cloudflare Workers AI adapter path.",
    docsPath: "/docs/reference/search#streaming-via-provider-entry-points",
    env: [
      {
        keys: ["CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID"],
        label: "CLOUDFLARE_ACCOUNT_ID or CF_ACCOUNT_ID",
      },
      {
        keys: [
          "CLOUDFLARE_API_TOKEN",
          "CLOUDFLARE_AI_API_TOKEN",
          "CF_API_TOKEN",
        ],
        label: "CLOUDFLARE_API_TOKEN, CLOUDFLARE_AI_API_TOKEN, or CF_API_TOKEN",
      },
    ],
    id: "cloudflare",
    label: "Cloudflare",
    wrapper: "leadtype/search/cloudflare",
  },
  tanstack: {
    description: "TanStack AI streaming wrapper with an explicit adapter.",
    docsPath: "/docs/reference/search#streaming-via-provider-entry-points",
    env: [
      { keys: ["OPENROUTER_API_KEY"], label: "OPENROUTER_API_KEY" },
      { keys: ["OPENAI_API_KEY"], label: "OPENAI_API_KEY" },
      { keys: ["ANTHROPIC_API_KEY"], label: "ANTHROPIC_API_KEY" },
      { keys: ["GEMINI_API_KEY"], label: "GEMINI_API_KEY" },
    ],
    id: "tanstack",
    label: "TanStack",
    wrapper: "leadtype/search/tanstack",
  },
  vercel: {
    description: "Vercel AI SDK / AI Gateway streaming wrapper.",
    docsPath: "/docs/reference/search#streaming-via-provider-entry-points",
    env: [
      {
        keys: ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"],
        label: "AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN",
      },
    ],
    id: "vercel",
    label: "Vercel",
    wrapper: "leadtype/search/vercel",
  },
} as const satisfies Record<DemoProviderId, ProviderSearchConfig>;

export interface ProviderAnswerConfig {
  enabled: boolean;
  env: Array<ProviderEnvironmentRequirement & { configured: boolean }>;
  label: string;
  model: string;
  provider: DemoProviderId;
  wrapper: string;
}
