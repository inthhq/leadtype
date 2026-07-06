import { mkdir } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../internal/atomic-fs.js";
import { normalizeBaseUrl } from "../internal/docs-url.js";
import type { LlmsProductInfo } from "../llm/llm.js";
import type { AgentReadabilityPage } from "../llm/readability.js";

export const NLWEB_SCHEMA_FEED_PATH = "feeds/schema.jsonl";
export const NLWEB_SCHEMA_MAP_PATH = "schema-map.xml";
export const DEFAULT_NLWEB_ASK_PATH = "/ask";

export type GenerateNlwebArtifactsConfig = {
  /** Output root (the site `public` dir). */
  outDir: string;
  baseUrl?: string;
  product: LlmsProductInfo;
  /** Pages from the agent-readability manifest. */
  pages: AgentReadabilityPage[];
};

export type GenerateNlwebArtifactsResult = {
  files: {
    schemaFeed: string;
    schemaMap: string;
  };
  /** Site-relative URL path of the schema map, for the robots.txt directive. */
  schemaMapUrlPath: string;
};

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
const XML_ESCAPE_PATTERN = /[&<>"']/g;

function escapeXml(value: string): string {
  return value.replace(XML_ESCAPE_PATTERN, (char) => XML_ESCAPES[char] ?? char);
}

function toSchemaFeedLine(
  page: AgentReadabilityPage,
  product: LlmsProductInfo,
  baseUrl: string
): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "@id": page.absoluteUrl,
    url: page.absoluteUrl,
    name: page.title,
    ...(page.description ? { description: page.description } : {}),
    ...(page.lastModified ? { dateModified: page.lastModified } : {}),
    isPartOf: {
      "@type": "WebSite",
      name: product.name,
      ...(baseUrl ? { url: baseUrl } : {}),
    },
  });
}

function renderSchemaMapXml(feedUrl: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    "<schemamap>",
    "  <feed>",
    `    <loc>${escapeXml(feedUrl)}</loc>`,
    "    <format>application/jsonl</format>",
    "    <itemType>https://schema.org/TechArticle</itemType>",
    "  </feed>",
    "</schemamap>",
    "",
  ].join("\n");
}

/**
 * Emit the NLWeb schema-feed surface: a JSONL feed of schema.org items (one
 * per docs page) plus a `/schema-map.xml` that lists it. Reference the map
 * from robots.txt via the `Schemamap:` directive (see `renderRobotsTxt`'s
 * `schemamapUrlPath`) so natural-language retrieval systems can find the feed.
 */
export async function generateNlwebArtifacts(
  config: GenerateNlwebArtifactsConfig
): Promise<GenerateNlwebArtifactsResult> {
  const outDir = path.resolve(config.outDir);
  const baseUrl = config.baseUrl ? normalizeBaseUrl(config.baseUrl) : "";
  const schemaFeed = path.join(outDir, NLWEB_SCHEMA_FEED_PATH);
  const schemaMap = path.join(outDir, NLWEB_SCHEMA_MAP_PATH);

  const lines = config.pages.map((page) =>
    toSchemaFeedLine(page, config.product, baseUrl)
  );
  await mkdir(path.dirname(schemaFeed), { recursive: true });
  await writeFileAtomic(schemaFeed, `${lines.join("\n")}\n`);
  await writeFileAtomic(
    schemaMap,
    renderSchemaMapXml(`${baseUrl}/${NLWEB_SCHEMA_FEED_PATH}`)
  );

  return {
    files: { schemaFeed, schemaMap },
    schemaMapUrlPath: `/${NLWEB_SCHEMA_MAP_PATH}`,
  };
}
