import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AgentReadabilityManifest,
  AgentReadabilityPage,
} from "../llm/readability";
import {
  createDocsSearchIndex,
  type DocsSearchDocument,
} from "../search/index";
import { generateNlwebArtifacts } from "./artifacts";
import {
  createAskHandler,
  NLWEB_PROTOCOL_VERSION,
  type NlwebAskResponse,
} from "./ask";

const docs: DocsSearchDocument[] = [
  {
    id: "quickstart",
    title: "Quickstart",
    description: "Install and configure the package.",
    urlPath: "/docs/guides/quickstart",
    absoluteUrl: "https://leadtype.dev/docs/guides/quickstart",
    relativePath: "guides/quickstart",
    content: "# Quickstart\n\nInstall the package and run leadtype generate.",
  },
  {
    id: "tabs",
    title: "Tabs",
    description: "Interactive tab controls.",
    urlPath: "/docs/components/tabs",
    absoluteUrl: "https://leadtype.dev/docs/components/tabs",
    relativePath: "components/tabs",
    content: "# Tabs\n\nPanels can be changed with arrow keys.",
  },
];

function pageFor(doc: DocsSearchDocument): AgentReadabilityPage {
  return {
    title: doc.title,
    description: doc.description ?? "",
    urlPath: doc.urlPath,
    absoluteUrl: doc.absoluteUrl,
    markdownUrlPath: `${doc.urlPath}.md`,
    markdownAbsoluteUrl: `${doc.absoluteUrl}.md`,
    relativePath: doc.relativePath,
    groups: doc.relativePath.split("/").slice(0, -1),
    lastModified: "2026-01-01T00:00:00.000Z",
  };
}

function buildManifest(): AgentReadabilityManifest {
  return {
    version: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    baseUrl: "https://leadtype.dev",
    product: { name: "Leadtype", summary: "Docs pipeline tooling." },
    pages: docs.map(pageFor),
    navigation: { groups: [], ungrouped: [], unknown: [] },
    files: {
      robotsTxt: "/robots.txt",
      sitemapMd: "/sitemap.md",
      sitemapXml: "/sitemap.xml",
    },
  };
}

describe("createAskHandler", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "leadtype-nlweb-"));
    const docsDir = join(dir, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFile(
      join(docsDir, "search-index.json"),
      JSON.stringify(createDocsSearchIndex(docs))
    );
    await writeFile(
      join(docsDir, "agent-readability.json"),
      JSON.stringify(buildManifest())
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("answers a GET ?query= with the NLWeb JSON document", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask?query=quickstart")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as NlwebAskResponse;
    expect(body._meta).toEqual({
      response_type: "answer",
      version: NLWEB_PROTOCOL_VERSION,
    });
    expect(body.query_id).toBeTruthy();
    expect(body.results.length).toBeGreaterThan(0);

    const top = body.results[0];
    expect(top?.url).toBe("https://leadtype.dev/docs/guides/quickstart");
    expect(top?.name).toBe("Quickstart");
    expect(top?.site).toBe("leadtype.dev");
    expect(top?.score).toBeGreaterThan(0);
    expect(top?.schema_object).toMatchObject({
      "@context": "https://schema.org",
      "@type": "TechArticle",
      url: "https://leadtype.dev/docs/guides/quickstart",
    });
  });

  it("accepts the POST document shape and echoes query_id", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: { text: "quickstart" },
          query_id: "q-123",
        }),
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as NlwebAskResponse;
    expect(body.query_id).toBe("q-123");
    expect(body.results[0]?.name).toBe("Quickstart");
  });

  it("streams SSE start/result/complete events for prefer.streaming", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: { text: "quickstart" },
          prefer: { streaming: true },
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    expect(text).toContain("event: start");
    expect(text).toContain("event: result");
    expect(text).toContain("event: complete");
    expect(text).toContain(`"version":"${NLWEB_PROTOCOL_VERSION}"`);
    // result events carry { index, item }.
    expect(text).toMatch(/"index":0/);
  });

  it("dedupes heading-level hits to one result per page", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask?query=quickstart&streaming=0")
    );
    const body = (await response.json()) as NlwebAskResponse;
    const urls = body.results.map((result) => result.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("rejects a missing query with a 400 failure response", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(new Request("https://app.local/ask"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as NlwebAskResponse;
    expect(body._meta.response_type).toBe("failure");
  });

  it("rejects unsupported methods with 405", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", { method: "DELETE" })
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toContain("GET");
  });

  it("returns a failure document (never throws) when artifacts can't load", async () => {
    const handler = createAskHandler({ artifacts: tmpdir() });
    const response = await handler(
      new Request("https://app.local/ask?query=anything")
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as NlwebAskResponse;
    expect(body._meta.response_type).toBe("failure");
  });
});

describe("generateNlwebArtifacts", () => {
  it("emits the JSONL schema feed and the schema map", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "leadtype-nlweb-gen-"));
    try {
      const result = await generateNlwebArtifacts({
        outDir,
        baseUrl: "https://leadtype.dev",
        product: { name: "Leadtype", summary: "Docs pipeline tooling." },
        pages: docs.map(pageFor),
      });

      expect(result.schemaMapUrlPath).toBe("/schema-map.xml");

      const feed = await readFile(result.files.schemaFeed, "utf8");
      const lines = feed.trim().split("\n");
      expect(lines).toHaveLength(docs.length);
      const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      expect(first).toMatchObject({
        "@context": "https://schema.org",
        "@type": "TechArticle",
        url: "https://leadtype.dev/docs/guides/quickstart",
        name: "Quickstart",
        dateModified: "2026-01-01T00:00:00.000Z",
      });
      expect(first.isPartOf).toMatchObject({
        "@type": "WebSite",
        name: "Leadtype",
        url: "https://leadtype.dev",
      });

      const map = await readFile(result.files.schemaMap, "utf8");
      expect(map).toContain("<schemamap>");
      expect(map).toContain(
        "<loc>https://leadtype.dev/feeds/schema.jsonl</loc>"
      );
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
