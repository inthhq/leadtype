import type {
  AgentReadabilityManifest,
  AgentReadabilityPage,
} from "leadtype/llm/readability";
import { renderJsonLd } from "leadtype/llm/readability";
import agentReadability from "@/generated/agent-readability.json";

const manifest = agentReadability as AgentReadabilityManifest;
const pagesByPath = new Map(
  manifest.pages.map((page) => [page.urlPath, page] as const)
);

interface HeadConfig {
  links: Record<string, string>[];
  meta: Record<string, string>[];
}

type JsonLdValue = Record<string, unknown>;

function pageTitle(page: AgentReadabilityPage): string {
  return `${page.title} | ${manifest.product.name}`;
}

function pageDescription(page: AgentReadabilityPage): string {
  return (
    page.description ||
    `${page.title} documentation for ${manifest.product.name}.`
  );
}

function jsonLdMeta(value: JsonLdValue): Record<string, string> {
  // TanStack Router supports this runtime key, but its public meta type does not
  // model non-string JSON-LD payloads yet.
  return { "script:ld+json": value } as unknown as Record<string, string>;
}

export function createDocsHead(urlPath: string): HeadConfig {
  const page = pagesByPath.get(urlPath);
  if (!page) {
    return {
      meta: [],
      links: [],
    };
  }

  const title = pageTitle(page);
  const description = pageDescription(page);
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      jsonLdMeta(renderJsonLd(page, manifest)),
    ],
    links: [
      { rel: "canonical", href: page.absoluteUrl },
      {
        rel: "alternate",
        type: "text/markdown",
        href: page.markdownAbsoluteUrl,
      },
    ],
  };
}
