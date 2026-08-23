import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateLockPath } from "../internal/generate-lock";
import type {
  AgentReadabilityManifest,
  AgentReadabilityPage,
} from "../llm/readability";
import { generateOpenApiPages, normalizeOpenApiConfig } from "../openapi/index";
import {
  createDocsSearchIndex,
  type DocsSearchDocument,
  docsSearchDefaults,
} from "../search/index";
import { generateNlwebArtifacts } from "./artifacts";
import {
  createAskHandler,
  NLWEB_ERROR_CODES,
  NLWEB_FAILURES,
  NLWEB_PROTOCOL_VERSION,
  type NlwebAskFailure,
  type NlwebAskResponse,
} from "./ask";
import {
  type AskOpenApiDocument,
  buildAskOpenApiDocument,
  NLWEB_API_CATALOG_TITLE,
  NLWEB_OPENAPI_MEDIA_TYPE,
  nlwebApiCatalogEntry,
  resolveAskEndpointLocation,
  resolveNlwebOpenApiConfig,
  withNlwebApiCatalogEntry,
  writeAskOpenApiDocument,
} from "./openapi";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

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
    generatedAt: GENERATED_AT,
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
      JSON.stringify(createDocsSearchIndex(docs, { generatedAt: GENERATED_AT }))
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

  it("rejects a missing query with a 400 failure envelope", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(new Request("https://app.local/ask"));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");

    const body = (await response.json()) as NlwebAskFailure;
    expect(body._meta).toEqual({
      response_type: "failure",
      version: NLWEB_PROTOCOL_VERSION,
    });
    expect(body.error.code).toBe(NLWEB_ERROR_CODES.missingQuery);
    expect(body.error.message).toBeTruthy();
    expect(body.error.resolution).toBeTruthy();
    expect(body.results).toEqual([]);
    expect(body.query_id).toBeTruthy();
  });

  it("separates malformed JSON from a missing query", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      })
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as NlwebAskFailure;
    expect(body.error.code).toBe(NLWEB_ERROR_CODES.invalidJson);
    expect(body.error.resolution).toBeTruthy();
  });

  it("answers an empty POST body from the URL query", async () => {
    const handler = createAskHandler({ artifacts: dir });
    for (const requestBody of [undefined, "", " \n"]) {
      const response = await handler(
        new Request("https://app.local/ask?query=quickstart", {
          method: "POST",
          ...(requestBody === undefined ? {} : { body: requestBody }),
        })
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as NlwebAskResponse;
      expect(body.results[0]?.name).toBe("Quickstart");
    }
  });

  it("rejects JSON that is not an /ask request document", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const bodies = ['"quickstart"', "[]", "null", '{ "query": 42 }'];
    for (const payload of bodies) {
      const response = await handler(
        new Request("https://app.local/ask?query=quickstart", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        })
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as NlwebAskFailure;
      expect(body.error.code).toBe(NLWEB_ERROR_CODES.invalidRequest);
    }
  });

  it("bounds JSON request bodies", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const oversizedBody = JSON.stringify({
      query: "x".repeat(docsSearchDefaults.maxBodyBytes),
    });
    const response = await handler(
      new Request("https://app.local/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: oversizedBody,
      })
    );
    const body = (await response.json()) as NlwebAskFailure;
    expect(response.status).toBe(413);
    expect(body.error.code).toBe(NLWEB_ERROR_CODES.requestTooLarge);
    expect(body.error.resolution).toContain("16 KiB");
  });

  it("preserves a readable body query_id when the query is invalid", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: 42, query_id: "q-invalid" }),
      })
    );
    const body = (await response.json()) as NlwebAskFailure;
    expect(body.error.code).toBe(NLWEB_ERROR_CODES.invalidRequest);
    expect(body.query_id).toBe("q-invalid");
  });

  it("rejects a non-string query_id rather than ignoring it", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "quickstart", query_id: 7 }),
      })
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as NlwebAskFailure;
    expect(body.error.code).toBe(NLWEB_ERROR_CODES.invalidRequest);
  });

  it("echoes a supplied query_id on failure responses", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask?query_id=q-failure")
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as NlwebAskFailure;
    expect(body.query_id).toBe("q-failure");
  });

  it("keeps failures JSON when the request asks for SSE", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", {
        headers: { accept: "text/event-stream" },
      })
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as NlwebAskFailure;
    expect(body.error.code).toBe(NLWEB_ERROR_CODES.missingQuery);
  });

  it("returns the failure envelope and Allow for unsupported methods", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask?query_id=q-method", {
        method: "DELETE",
      })
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as NlwebAskFailure;
    expect(body._meta.response_type).toBe("failure");
    expect(body.error.code).toBe(NLWEB_ERROR_CODES.methodNotAllowed);
    expect(body.error.resolution).toContain("GET");
    expect(body.query_id).toBe("q-method");

    const requestWithBody = new Request(
      "https://app.local/ask?query_id=q-method-url",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query_id: "q-method-body" }),
      }
    );
    const responseWithBody = await handler(requestWithBody);
    const bodyWithId = (await responseWithBody.json()) as NlwebAskFailure;
    expect(responseWithBody.status).toBe(405);
    expect(bodyWithId.query_id).toBe("q-method-url");
    expect(requestWithBody.bodyUsed).toBe(false);
  });

  it("preserves the URL query_id when reading the body fails", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const request = new Request(
      "https://app.local/ask?query=quickstart&query_id=q-consumed",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "quickstart" }),
      }
    );
    await request.text();

    const response = await handler(request);
    const body = (await response.json()) as NlwebAskFailure;
    expect(response.status).toBe(500);
    expect(body.error.code).toBe(NLWEB_ERROR_CODES.internalError);
    expect(body.query_id).toBe("q-consumed");
  });

  it("answers OPTIONS with a bodyless 204 preflight", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", { method: "OPTIONS" })
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, OPTIONS"
    );
    expect(await response.text()).toBe("");
  });

  it("reports unavailable artifacts without leaking filesystem paths", async () => {
    const missing = join(tmpdir(), "leadtype-nlweb-missing");
    let reportedError: unknown;
    const handler = createAskHandler({
      artifacts: missing,
      onError: (error) => {
        reportedError = error;
      },
    });
    const response = await handler(
      new Request("https://app.local/ask?query=anything")
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as NlwebAskFailure;
    expect(body._meta.response_type).toBe("failure");
    expect(body.error.code).toBe(NLWEB_ERROR_CODES.artifactsUnavailable);
    expect(body.error.resolution).toBeTruthy();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(missing);
    expect(serialized).not.toContain(tmpdir());
    expect(serialized).not.toContain("docs/search-index.json");
    expect(reportedError).toBeInstanceOf(Error);
    expect((reportedError as Error).message).toContain(missing);

    const rejectingReporter = createAskHandler({
      artifacts: missing,
      onError: async () => {
        throw new Error("reporter unavailable");
      },
    });
    const responseWithReporterFailure = await rejectingReporter(
      new Request("https://app.local/ask?query=anything")
    );
    expect(responseWithReporterFailure.status).toBe(500);
  });

  it("reports a missing NLWeb content store only through onError", async () => {
    const artifacts = await mkdtemp(join(tmpdir(), "leadtype-nlweb-content-"));
    try {
      const docsDir = join(artifacts, "docs");
      await mkdir(docsDir, { recursive: true });
      const index = createDocsSearchIndex(docs, { generatedAt: GENERATED_AT });
      await writeFile(
        join(docsDir, "search-index.json"),
        JSON.stringify({ ...index, content: undefined })
      );
      await writeFile(
        join(docsDir, "agent-readability.json"),
        JSON.stringify(buildManifest())
      );
      let reportedError: unknown;
      const response = await createAskHandler({
        artifacts,
        onError: (error) => {
          reportedError = error;
        },
      })(new Request("https://app.local/ask?query=quickstart"));

      expect(response.status).toBe(500);
      const body = (await response.json()) as NlwebAskFailure;
      expect(body.error.code).toBe(NLWEB_ERROR_CODES.artifactsUnavailable);
      expect(reportedError).toBeInstanceOf(Error);
      expect((reportedError as Error).message).toContain("search-index.json");
      expect((reportedError as Error).message).toContain("search-content.json");
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("search-index.json");
      expect(serialized).not.toContain("search-content.json");
    } finally {
      await rm(artifacts, { force: true, recursive: true });
    }
  });

  it("classifies malformed generated artifacts as unavailable", async () => {
    const validIndexObject = createDocsSearchIndex(docs, {
      generatedAt: GENERATED_AT,
    });
    const validContent = validIndexObject.content;
    if (!validContent) {
      throw new Error("Expected the generated search index to embed content.");
    }
    const duplicateIdChunks = validIndexObject.chunks.map((chunk) => [
      ...chunk,
    ]);
    const [firstChunk, secondChunk] = duplicateIdChunks;
    if (!(firstChunk && secondChunk)) {
      throw new Error("Expected at least two generated search chunks.");
    }
    secondChunk[0] = firstChunk[0];
    const duplicateContentChunks = validIndexObject.chunks.map((chunk) => [
      ...chunk,
    ]);
    const [firstContentChunk, secondContentChunk] = duplicateContentChunks;
    if (!(firstContentChunk && secondContentChunk)) {
      throw new Error("Expected at least two generated content chunks.");
    }
    secondContentChunk[5] = firstContentChunk[5];
    const permutedContentChunks = validIndexObject.chunks.map((chunk) => [
      ...chunk,
    ]);
    const [firstPermutedChunk, secondPermutedChunk] = permutedContentChunks;
    if (!(firstPermutedChunk && secondPermutedChunk)) {
      throw new Error("Expected at least two generated content chunks.");
    }
    const firstContentIndex = firstPermutedChunk[5];
    firstPermutedChunk[5] = secondPermutedChunk[5];
    secondPermutedChunk[5] = firstContentIndex;
    const fractionalLengthChunks = validIndexObject.chunks.map((chunk) => [
      ...chunk,
    ]);
    fractionalLengthChunks[0][4] = 0.5;
    const fractionalAverageChunkLength =
      fractionalLengthChunks.reduce((sum, chunk) => sum + Number(chunk[4]), 0) /
      fractionalLengthChunks.length;
    const unsafeLengthChunks = validIndexObject.chunks.map((chunk) => [
      ...chunk,
    ]);
    unsafeLengthChunks[0][4] = Number.MAX_SAFE_INTEGER + 1;
    const unsafeAverageChunkLength =
      unsafeLengthChunks.reduce((sum, chunk) => sum + Number(chunk[4]), 0) /
      unsafeLengthChunks.length;
    const swappedLengthChunks = validIndexObject.chunks.map((chunk) => [
      ...chunk,
    ]);
    const [firstLengthChunk, secondLengthChunk] = swappedLengthChunks;
    if (
      !(firstLengthChunk && secondLengthChunk) ||
      firstLengthChunk[4] === secondLengthChunk[4]
    ) {
      throw new Error("Expected two generated chunks with unequal lengths.");
    }
    const firstLength = firstLengthChunk[4];
    firstLengthChunk[4] = secondLengthChunk[4];
    secondLengthChunk[4] = firstLength;
    const incompleteTerms = { ...validIndexObject.terms };
    const removedTerm = Object.keys(incompleteTerms)[0];
    if (!removedTerm) {
      throw new Error("Expected the generated search index to contain terms.");
    }
    delete incompleteTerms[removedTerm];
    const inflatedVisibleTerms = structuredClone(validIndexObject.terms);
    const inflatedVisibleEntry = Object.entries(inflatedVisibleTerms)[0];
    const inflatedVisiblePosting = inflatedVisibleEntry?.[1][0];
    if (!(inflatedVisibleEntry && inflatedVisiblePosting)) {
      throw new Error("Expected a generated visible-term posting.");
    }
    inflatedVisiblePosting[1] += 1;
    const validIndex = JSON.stringify(validIndexObject);
    const validManifest = JSON.stringify(buildManifest());
    const cases = [
      ["{", validManifest, "quickstart"],
      ["{}", validManifest, "the"],
      [validIndex, "{}", "quickstart"],
      [
        JSON.stringify({ ...validIndexObject, documents: [null] }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({ ...validIndexObject, chunks: [null] }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({ ...validIndexObject, chunks: duplicateIdChunks }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          chunks: duplicateContentChunks,
        }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          chunks: permutedContentChunks,
        }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({ ...validIndexObject, averageChunkLength: -1 }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({ ...validIndexObject, averageChunkLength: 0 }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          averageChunkLength: validIndexObject.averageChunkLength + 1,
        }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          chunks: fractionalLengthChunks,
          averageChunkLength: fractionalAverageChunkLength,
        }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          chunks: unsafeLengthChunks,
          averageChunkLength: unsafeAverageChunkLength,
        }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({ ...validIndexObject, chunks: swappedLengthChunks }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({ ...validIndexObject, terms: {} }),
        validManifest,
        "quickstart",
      ],
      [
        JSON.stringify({ ...validIndexObject, terms: incompleteTerms }),
        validManifest,
        removedTerm,
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          terms: inflatedVisibleTerms,
        }),
        validManifest,
        inflatedVisibleEntry[0],
      ],
      [
        JSON.stringify({ ...validIndexObject, terms: { broken: [null] } }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          terms: { overflow: [[0, Number.MAX_VALUE, 0, 0, 0]] },
        }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          terms: { zero: [[0, 0, 0, 0, 0]] },
        }),
        validManifest,
        "zero",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          terms: { ...validIndexObject.terms, empty: [] },
        }),
        validManifest,
        "empty",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          terms: {
            duplicated: [
              [0, 1, 0, 0, 0],
              [0, 0, 1, 0, 0],
            ],
          },
        }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          terms: {
            ...validIndexObject.terms,
            bogus: [[0, 1, 0, 0, 0]],
          },
        }),
        validManifest,
        "bogus",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          terms: {
            ...validIndexObject.terms,
            boguscode: [[0, 0, 0, 0, 1]],
          },
        }),
        validManifest,
        "boguscode",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          content: { ...validContent, chunks: [null] },
        }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({
          ...validIndexObject,
          content: { ...validContent, generatedAt: "stale" },
        }),
        validManifest,
        "the",
      ],
      [
        JSON.stringify({ ...validIndexObject, content: undefined }),
        validManifest,
        "quickstart",
      ],
      [
        JSON.stringify({ ...validIndexObject, content: undefined }),
        validManifest,
        "the",
        JSON.stringify({ ...validContent, generatedAt: "stale" }),
      ],
    ] as const;

    for (const [searchIndex, manifest, query, searchContent] of cases) {
      const malformed = await mkdtemp(
        join(tmpdir(), "leadtype-nlweb-malformed-")
      );
      try {
        const docsDir = join(malformed, "docs");
        await mkdir(docsDir, { recursive: true });
        await writeFile(join(docsDir, "search-index.json"), searchIndex);
        await writeFile(join(docsDir, "agent-readability.json"), manifest);
        if (searchContent) {
          await writeFile(join(docsDir, "search-content.json"), searchContent);
        }
        let reportedError: unknown;
        const handler = createAskHandler({
          artifacts: malformed,
          onError: (error) => {
            reportedError = error;
          },
        });

        const response = await handler(
          new Request(`https://app.local/ask?query=${query}`)
        );
        const body = (await response.json()) as NlwebAskFailure;
        expect(response.status).toBe(500);
        expect(body.error.code).toBe(NLWEB_ERROR_CODES.artifactsUnavailable);
        expect(reportedError).toBeInstanceOf(Error);
      } finally {
        await rm(malformed, { recursive: true, force: true });
      }
    }
  });

  it("accepts independently generated manifest and search timestamps", async () => {
    const artifacts = await mkdtemp(
      join(tmpdir(), "leadtype-nlweb-independent-timestamps-")
    );
    try {
      const docsDir = join(artifacts, "docs");
      await mkdir(docsDir, { recursive: true });
      await writeFile(
        join(docsDir, "search-index.json"),
        JSON.stringify(
          createDocsSearchIndex(docs, { generatedAt: GENERATED_AT })
        )
      );
      await writeFile(
        join(docsDir, "agent-readability.json"),
        JSON.stringify({ ...buildManifest(), generatedAt: "2026-01-02" })
      );

      const response = await createAskHandler({ artifacts })(
        new Request("https://app.local/ask?query=quickstart")
      );
      expect(response.status).toBe(200);
    } finally {
      await rm(artifacts, { recursive: true, force: true });
    }
  });

  it("accepts transformer-generated code-only search terms", async () => {
    const artifacts = await mkdtemp(
      join(tmpdir(), "leadtype-nlweb-code-only-term-")
    );
    try {
      const docsDir = join(artifacts, "docs");
      await mkdir(docsDir, { recursive: true });
      const codeOnlyTerm = "transformercodeonly";
      const index = createDocsSearchIndex(docs, {
        generatedAt: GENERATED_AT,
        transformers: [
          {
            name: "code-only-term",
            beforeSearchChunk: (chunk) => ({
              ...chunk,
              codeText: `${chunk.codeText}\n${codeOnlyTerm}`,
            }),
          },
        ],
      });
      expect(
        index.content?.chunks.every((chunk) => !chunk.includes(codeOnlyTerm))
      ).toBe(true);
      expect(
        index.content?.codeChunks.every((chunk) => chunk.includes(codeOnlyTerm))
      ).toBe(true);
      expect(
        index.terms[codeOnlyTerm]?.every(
          ([, title, heading, body, code]) =>
            title === 0 && heading === 0 && body === 0 && code > 0
        )
      ).toBe(true);
      await writeFile(
        join(docsDir, "search-index.json"),
        JSON.stringify(index)
      );
      await writeFile(
        join(docsDir, "agent-readability.json"),
        JSON.stringify(buildManifest())
      );

      const response = await createAskHandler({ artifacts })(
        new Request(`https://app.local/ask?query=${codeOnlyTerm}`)
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as NlwebAskResponse;
      expect(body.results.length).toBeGreaterThan(0);

      const forgedIndex = structuredClone(index);
      const forgedPosting = forgedIndex.terms[codeOnlyTerm]?.[0];
      if (!forgedPosting) {
        throw new Error("Expected a generated code-only posting.");
      }
      forgedPosting[4] += 1;
      await writeFile(
        join(docsDir, "search-index.json"),
        JSON.stringify(forgedIndex)
      );
      const forgedResponse = await createAskHandler({ artifacts })(
        new Request(`https://app.local/ask?query=${codeOnlyTerm}`)
      );
      expect(forgedResponse.status).toBe(500);
      expect(
        ((await forgedResponse.json()) as NlwebAskFailure).error.code
      ).toBe(NLWEB_ERROR_CODES.artifactsUnavailable);
    } finally {
      await rm(artifacts, { recursive: true, force: true });
    }
  });

  it("rejects unsupported search-index versions before serving", async () => {
    const artifacts = await mkdtemp(
      join(tmpdir(), "leadtype-nlweb-index-version-")
    );
    try {
      const docsDir = join(artifacts, "docs");
      await mkdir(docsDir, { recursive: true });
      const index = createDocsSearchIndex(docs, { generatedAt: GENERATED_AT });
      await writeFile(
        join(docsDir, "search-index.json"),
        JSON.stringify({ ...index, version: index.version + 1 })
      );
      await writeFile(
        join(docsDir, "agent-readability.json"),
        JSON.stringify(buildManifest())
      );
      let reportedError: unknown;
      const response = await createAskHandler({
        artifacts,
        onError: (error) => {
          reportedError = error;
        },
      })(new Request("https://app.local/ask?query=quickstart"));

      expect(response.status).toBe(500);
      const body = (await response.json()) as NlwebAskFailure;
      expect(body.error.code).toBe(NLWEB_ERROR_CODES.artifactsUnavailable);
      expect(reportedError).toBeInstanceOf(Error);
      expect((reportedError as Error).message).toMatch(
        /search-index\.json uses an unsupported version.*leadtype generate/
      );
    } finally {
      await rm(artifacts, { recursive: true, force: true });
    }
  });

  it("accepts an equivalent average chunk length within rounding tolerance", async () => {
    const artifacts = await mkdtemp(
      join(tmpdir(), "leadtype-nlweb-rounded-average-")
    );
    try {
      const docsDir = join(artifacts, "docs");
      await mkdir(docsDir, { recursive: true });
      const index = createDocsSearchIndex(docs, { generatedAt: GENERATED_AT });
      const exactAverageChunkLength = index.averageChunkLength;
      const oneUlp =
        Number.EPSILON * 2 ** Math.floor(Math.log2(exactAverageChunkLength));
      index.averageChunkLength += oneUlp;
      expect(index.averageChunkLength).not.toBe(exactAverageChunkLength);
      await writeFile(
        join(docsDir, "search-index.json"),
        JSON.stringify(index)
      );
      await writeFile(
        join(docsDir, "agent-readability.json"),
        JSON.stringify(buildManifest())
      );

      const response = await createAskHandler({ artifacts })(
        new Request("https://app.local/ask?query=quickstart")
      );
      expect(response.status).toBe(200);
    } finally {
      await rm(artifacts, { recursive: true, force: true });
    }
  });

  it("accepts the empty product name allowed by config validation", async () => {
    const artifacts = await mkdtemp(
      join(tmpdir(), "leadtype-nlweb-empty-name-")
    );
    try {
      const docsDir = join(artifacts, "docs");
      await mkdir(docsDir, { recursive: true });
      await writeFile(
        join(docsDir, "search-index.json"),
        JSON.stringify(
          createDocsSearchIndex(docs, { generatedAt: GENERATED_AT })
        )
      );
      const manifest = buildManifest();
      await writeFile(
        join(docsDir, "agent-readability.json"),
        JSON.stringify({
          ...manifest,
          product: { ...manifest.product, name: "" },
        })
      );

      const response = await createAskHandler({ artifacts })(
        new Request("https://app.local/ask?query=quickstart")
      );
      expect(response.status).toBe(200);
    } finally {
      await rm(artifacts, { recursive: true, force: true });
    }
  });

  it("reloads artifacts after a validation failure", async () => {
    const artifacts = await mkdtemp(join(tmpdir(), "leadtype-nlweb-retry-"));
    try {
      const docsDir = join(artifacts, "docs");
      const indexPath = join(docsDir, "search-index.json");
      await mkdir(docsDir, { recursive: true });
      await writeFile(indexPath, "{}");
      await writeFile(
        join(docsDir, "agent-readability.json"),
        JSON.stringify(buildManifest())
      );
      const handler = createAskHandler({ artifacts });

      const invalid = await handler(
        new Request("https://app.local/ask?query=the")
      );
      expect(invalid.status).toBe(500);
      expect(((await invalid.json()) as NlwebAskFailure).error.code).toBe(
        NLWEB_ERROR_CODES.artifactsUnavailable
      );

      await writeFile(
        indexPath,
        JSON.stringify(
          createDocsSearchIndex(docs, { generatedAt: GENERATED_AT })
        )
      );
      const repaired = await handler(
        new Request("https://app.local/ask?query=quickstart")
      );
      expect(repaired.status).toBe(200);
      const body = (await repaired.json()) as NlwebAskAnswer;
      expect(body.results[0]?.name).toBe("Quickstart");
    } finally {
      await rm(artifacts, { recursive: true, force: true });
    }
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

  it("validates the OpenAPI output before writing schema artifacts", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "leadtype-nlweb-validate-"));
    const schemaFeed = join(outDir, "feeds", "schema.jsonl");
    const schemaMap = join(outDir, "schema-map.xml");
    try {
      await mkdir(join(outDir, "feeds"), { recursive: true });
      await writeFile(schemaFeed, "existing feed\n");
      await writeFile(schemaMap, "existing map\n");

      await expect(
        generateNlwebArtifacts({
          outDir,
          product: { name: "Leadtype", summary: "Docs pipeline tooling." },
          pages: docs.map(pageFor),
          openapi: { output: "../openapi.json" },
        })
      ).rejects.toThrow(/agents\.nlweb\.openapi\.output/);

      await expect(readFile(schemaFeed, "utf8")).resolves.toBe(
        "existing feed\n"
      );
      await expect(readFile(schemaMap, "utf8")).resolves.toBe("existing map\n");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

type RefWalkTarget = Record<string, unknown> | unknown[];

/** Every `$ref` in the document, so a test can prove each one resolves. */
function collectRefs(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, found);
    }
    return found;
  }
  if (typeof value !== "object" || value === null) {
    return found;
  }
  for (const [key, child] of Object.entries(value as RefWalkTarget)) {
    if (key === "$ref" && typeof child === "string") {
      found.push(child);
      continue;
    }
    collectRefs(child, found);
  }
  return found;
}

function readPointer(document: unknown, pointer: string): unknown {
  let node: unknown = document;
  for (const segment of pointer.replace("#/", "").split("/")) {
    if (typeof node !== "object" || node === null) {
      return;
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

function operationsOf(
  document: AskOpenApiDocument,
  pathKey: string
): [string, Record<string, unknown>][] {
  const pathItem = document.paths[pathKey] ?? {};
  return Object.entries(pathItem).filter(
    ([method]) => method === "get" || method === "post" || method === "options"
  ) as [string, Record<string, unknown>][];
}

const product = { name: "Leadtype", summary: "Docs pipeline tooling." };

describe("buildAskOpenApiDocument", () => {
  const document = buildAskOpenApiDocument({
    product,
    baseUrl: "https://leadtype.dev",
    docsUrl: "https://leadtype.dev/docs/reference/nlweb",
  });

  it("describes the /ask endpoint as an OpenAPI 3.1 document", () => {
    expect(document.openapi.startsWith("3.1")).toBe(true);
    expect(Object.keys(document.paths)).toEqual(["/ask"]);
    expect(document.servers).toEqual([
      {
        url: "https://leadtype.dev",
        description: "Leadtype documentation site",
      },
    ]);
    expect(document.info.version).toBe(NLWEB_PROTOCOL_VERSION);
    expect(document.externalDocs).toMatchObject({
      url: "https://leadtype.dev/docs/reference/nlweb",
    });
    expect(document["x-leadtype-generated"]).toMatchObject({
      generator: "leadtype",
      version: 1,
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("gives every operation a unique operationId and a description", () => {
    const operations = operationsOf(document, "/ask");
    expect(operations.map(([method]) => method)).toEqual([
      "get",
      "post",
      "options",
    ]);
    const ids = operations.map(([, operation]) => operation.operationId);
    expect(ids).toEqual(["nlwebAskGet", "nlwebAskPost", "nlwebAskOptions"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, operation] of operations) {
      expect(operation.summary).toBeTruthy();
      expect(String(operation.description).length).toBeGreaterThan(40);
    }
  });

  it("types the GET query parameters the handler reads", () => {
    const parameters = document.components.parameters as Record<
      string,
      { name: string; in: string }
    >;
    expect(
      Object.values(parameters)
        .filter((parameter) => parameter.in === "query")
        .map((parameter) => parameter.name)
    ).toEqual(["query", "q", "query_id", "streaming"]);
    const get = document.paths["/ask"]?.get as { parameters: unknown[] };
    expect(collectRefs(get.parameters)).toEqual([
      "#/components/parameters/AskQuery",
      "#/components/parameters/AskQueryAlias",
      "#/components/parameters/AskQueryId",
      "#/components/parameters/AskStreaming",
    ]);
  });

  it("models both POST request shapes and keeps the body optional", () => {
    const post = document.paths["/ask"]?.post as {
      parameters: unknown[];
      requestBody: {
        required: boolean;
        content: Record<string, { examples: Record<string, unknown> }>;
      };
    };
    // A POST still reads URL parameters, so it declares the same ones as GET.
    expect(collectRefs(post.parameters)).toHaveLength(4);
    expect(post.requestBody.required).toBe(false);
    expect(
      Object.keys(post.requestBody.content["application/json"].examples)
    ).toEqual(["flat", "nlweb"]);

    const request = document.components.schemas.AskRequest as {
      properties: { query: { oneOf: { type: string }[] } };
    };
    expect(request.properties.query.oneOf.map((form) => form.type)).toEqual([
      "string",
      "object",
    ]);
  });

  it("describes the JSON answer and the SSE stream on the same 200", () => {
    const answer = document.components.responses.AskAnswer as {
      content: Record<string, unknown>;
      "x-sse-events": Record<string, { $ref: string }>;
    };
    expect(Object.keys(answer.content)).toEqual([
      "application/json",
      "text/event-stream",
    ]);
    expect(Object.keys(answer["x-sse-events"])).toEqual([
      "start",
      "result",
      "complete",
    ]);
    expect(answer["x-sse-events"].result.$ref).toBe(
      "#/components/schemas/AskStreamResult"
    );
  });

  it("shares one failure envelope across every error status", () => {
    const responses = document.components.responses as Record<
      string,
      {
        content?: Record<string, { schema: { $ref: string } }>;
        headers: Record<string, unknown>;
      }
    >;
    for (const name of [
      "AskBadRequest",
      "AskContentTooLarge",
      "AskMethodNotAllowed",
      "AskInternalError",
    ]) {
      expect(responses[name].content?.["application/json"].schema.$ref).toBe(
        "#/components/schemas/AskFailure"
      );
    }
    expect(responses.AskMethodNotAllowed.headers.Allow).toMatchObject({
      schema: { const: "GET, POST, OPTIONS" },
    });

    const error = document.components.schemas.AskError as {
      properties: { code: { enum: string[] } };
    };
    expect(new Set(error.properties.code.enum)).toEqual(
      new Set(Object.values(NLWEB_ERROR_CODES))
    );
    const errorSchema = document.components.schemas.AskError as {
      required: string[];
    };
    expect(errorSchema.required).toEqual(["code", "message", "resolution"]);
    const failureMeta = document.components.schemas.AskFailureMeta as {
      properties: Record<string, unknown>;
    };
    expect(failureMeta.properties.streaming).toBeUndefined();

    for (const response of Object.values(responses)) {
      const examples = response.content?.["application/json"]?.examples as
        | Record<string, { value: NlwebAskFailure }>
        | undefined;
      for (const [code, example] of Object.entries(examples ?? {})) {
        expect(example.value.error).toEqual(
          NLWEB_FAILURES[code as keyof typeof NLWEB_FAILURES]
        );
      }
    }

    const pathItem = document.paths["/ask"] as {
      get: { responses: Record<string, unknown> };
      post: { responses: Record<string, unknown> };
    };
    expect(Object.keys(pathItem.get.responses)).toEqual(["200", "400", "500"]);
    expect(Object.keys(pathItem.post.responses)).toEqual([
      "200",
      "400",
      "413",
      "500",
    ]);
  });

  it("publishes the 405 at the path, where the rejected methods live", () => {
    // A 405 can only come from a method this document has no operation for, so
    // hanging it off GET or POST would describe a response they never send.
    const pathItem = document.paths["/ask"] as {
      "x-leadtype-method-not-allowed": { response: { $ref: string } };
    };
    expect(pathItem["x-leadtype-method-not-allowed"].response.$ref).toBe(
      "#/components/responses/AskMethodNotAllowed"
    );
  });

  it("describes the CORS preflight and the CORS response header", () => {
    const options = document.paths["/ask"]?.options as {
      responses: Record<string, unknown>;
    };
    expect(Object.keys(options.responses)).toEqual(["204"]);
    const preflight = document.components.responses.AskPreflight as {
      headers: Record<string, { schema: { const: string } }>;
      content?: unknown;
    };
    expect(preflight.content).toBeUndefined();
    expect(preflight.headers["Access-Control-Allow-Methods"].schema.const).toBe(
      "GET, POST, OPTIONS"
    );
    expect(preflight.headers["Access-Control-Allow-Headers"].schema.const).toBe(
      "content-type, accept"
    );
    const answer = document.components.responses.AskAnswer as {
      headers: Record<string, { schema: { const: string } }>;
    };
    expect(answer.headers["Access-Control-Allow-Origin"].schema.const).toBe(
      "*"
    );
  });

  it("resolves every internal reference", () => {
    const refs = collectRefs(document);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith("#/")).toBe(true);
      expect(readPointer(document, ref)).toBeTruthy();
    }
  });

  it("splits an absolute ask endpoint into a server and a paths key", () => {
    const absolute = buildAskOpenApiDocument({
      product,
      baseUrl: "https://leadtype.dev",
      askEndpoint: "https://api.leadtype.dev/v1/ask/",
    });
    expect(absolute.servers?.[0]?.url).toBe("https://api.leadtype.dev");
    expect(Object.keys(absolute.paths)).toEqual(["/v1/ask/"]);
  });

  it("keeps a relative endpoint rooted, and omits servers with no base URL", () => {
    const relative = buildAskOpenApiDocument({
      product,
      askEndpoint: "nlweb/ask/",
    });
    expect(Object.keys(relative.paths)).toEqual(["/nlweb/ask/"]);
    expect(relative.servers).toBeUndefined();
  });

  it("rejects parent-relative endpoint paths at the exported boundary", () => {
    expect(() =>
      resolveAskEndpointLocation("../ask", "https://example.com/docs")
    ).toThrow(/askEndpoint.*must not contain "\.\." path segments/);
  });

  it("rejects endpoint queries and fragments at the exported boundary", () => {
    for (const endpoint of [
      "/ask?tenant=acme",
      "/ask#results",
      "https://api.example/ask?tenant=acme",
      "https://api.example/ask#results",
    ]) {
      expect(() => resolveAskEndpointLocation(endpoint)).toThrow(
        /askEndpoint.*must not contain a query string or fragment/
      );
    }
  });

  it("rejects malformed endpoints at the exported boundary", () => {
    for (const endpoint of [
      "//api.example/ask",
      "mailto:ask@example.com",
      "custom:ask",
      "https:ask",
      "",
      " /ask ",
      "/api\\ask",
      "/ask\nnext",
      "/ask%ZZ",
    ]) {
      expect(() => resolveAskEndpointLocation(endpoint)).toThrow(
        /askEndpoint must/
      );
    }
    expect(resolveAskEndpointLocation()).toEqual({ pathKey: "/ask" });
    expect(resolveAskEndpointLocation("ask")).toEqual({ pathKey: "/ask" });
    expect(resolveAskEndpointLocation("/v1/ask")).toEqual({
      pathKey: "/v1/ask",
    });
    expect(resolveAskEndpointLocation("https://api.example/v1/ask")).toEqual({
      pathKey: "/v1/ask",
      serverUrl: "https://api.example",
    });
  });
});

describe("the OpenAPI document against createAskHandler", () => {
  let dir: string;
  const document = buildAskOpenApiDocument({ product });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "leadtype-nlweb-contract-"));
    const docsDir = join(dir, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFile(
      join(docsDir, "search-index.json"),
      JSON.stringify(createDocsSearchIndex(docs, { generatedAt: GENERATED_AT }))
    );
    await writeFile(
      join(docsDir, "agent-readability.json"),
      JSON.stringify(buildManifest())
    );
  });

  afterAll(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("declares the headers the OPTIONS preflight actually answers with", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", { method: "OPTIONS" })
    );
    const preflight = document.components.responses.AskPreflight as {
      headers: Record<string, { schema: { const: string } }>;
    };

    expect(String(response.status)).toBe(
      Object.keys(
        (document.paths["/ask"]?.options as { responses: object }).responses
      )[0]
    );
    for (const [header, declared] of Object.entries(preflight.headers)) {
      expect(response.headers.get(header.toLowerCase())).toBe(
        declared.schema.const
      );
    }
  });

  it("declares the Allow header the 405 actually carries", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", { method: "DELETE" })
    );
    const rejected = document.components.responses.AskMethodNotAllowed as {
      headers: Record<string, { schema: { const: string } }>;
    };

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe(
      rejected.headers.Allow.schema.const
    );
    const body = (await response.json()) as NlwebAskFailure;
    const failure = document.components.schemas.AskFailure as {
      required: string[];
    };
    expect(Object.keys(body).sort()).toEqual([...failure.required].sort());
  });

  it("declares an answer shape the handler produces", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask?query=quickstart")
    );
    const body = (await response.json()) as NlwebAskResponse;
    const answer = document.components.schemas.AskAnswer as {
      required: string[];
    };
    const result = document.components.schemas.AskResult as {
      required: string[];
    };

    expect(Object.keys(body).sort()).toEqual([...answer.required].sort());
    expect(Object.keys(body.results[0] ?? {}).sort()).toEqual(
      [...result.required].sort()
    );
  });

  it("declares the body-limit failure POST actually produces", async () => {
    const handler = createAskHandler({ artifacts: dir });
    const response = await handler(
      new Request("https://app.local/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "x".repeat(docsSearchDefaults.maxBodyBytes),
        }),
      })
    );
    const post = document.paths["/ask"]?.post as {
      responses: Record<string, { $ref: string }>;
    };
    expect(response.status).toBe(413);
    expect(post.responses[String(response.status)]?.$ref).toBe(
      "#/components/responses/AskContentTooLarge"
    );
    const body = (await response.json()) as NlwebAskFailure;
    expect(body.error).toEqual(
      NLWEB_FAILURES[NLWEB_ERROR_CODES.requestTooLarge]
    );
    const failure = document.components.schemas.AskFailure as {
      required: string[];
    };
    expect(Object.keys(body).sort()).toEqual([...failure.required].sort());
  });
});

describe("resolveNlwebOpenApiConfig", () => {
  it("defaults to /openapi.json in the output root", () => {
    expect(resolveNlwebOpenApiConfig(undefined)).toEqual({
      url: "/openapi.json",
      output: "openapi.json",
    });
  });

  it("derives the output path from the public URL", () => {
    expect(
      resolveNlwebOpenApiConfig({
        url: "/api/openapi.json?download=1#contract",
      })
    ).toEqual({
      url: "/api/openapi.json?download=1#contract",
      output: "api/openapi.json",
    });
    expect(
      resolveNlwebOpenApiConfig({ url: "/api/öpen api.json?download=1" })
    ).toEqual({
      url: "/api/öpen api.json?download=1",
      output: "api/öpen api.json",
    });
    expect(
      resolveNlwebOpenApiConfig({
        url: "/api%20spec/%C3%B6penapi.json",
      })
    ).toEqual({
      url: "/api%20spec/%C3%B6penapi.json",
      output: "api spec/öpenapi.json",
    });
  });

  it("derives the public URL from an explicit output path", () => {
    expect(resolveNlwebOpenApiConfig({ output: "api/openapi.json" })).toEqual({
      url: "/api/openapi.json",
      output: "api/openapi.json",
    });
    expect(() =>
      resolveNlwebOpenApiConfig({ output: "api%20spec/openapi.json" })
    ).toThrow(/output.*must not contain percent escapes/);
    expect(() => resolveNlwebOpenApiConfig({ output: "%6dcp.json" })).toThrow(
      /output.*must not contain percent escapes/
    );
  });

  it("validates a public URL derived from the output path", () => {
    expect(() =>
      resolveNlwebOpenApiConfig({ output: "api%/openapi.json" })
    ).toThrow(/agents\.nlweb\.openapi\.output.*malformed percent escape/);
  });

  it("keeps an explicit output alongside an absolute URL", () => {
    expect(
      resolveNlwebOpenApiConfig({
        url: "https://cdn.example.com/ask.json",
        output: "ask.json",
      })
    ).toEqual({ url: "https://cdn.example.com/ask.json", output: "ask.json" });
  });

  it("returns null when the document is turned off", () => {
    expect(resolveNlwebOpenApiConfig({ enabled: false })).toBeNull();
  });

  it("rejects explicitly empty document targets", () => {
    for (const config of [
      { url: "" },
      { output: "" },
      { url: "", output: "api.json" },
      { url: "/api.json", output: "" },
    ]) {
      expect(() => resolveNlwebOpenApiConfig(config)).toThrow(
        /agents\.nlweb\.openapi\.(?:url|output).*must not be empty/
      );
    }
  });

  it("rejects an output path that escapes or overwrites the output root", () => {
    const rejected = [
      "../openapi.json",
      "api/../../openapi.json",
      "/etc/openapi.json",
      "openapi.yaml",
      "mcp.json",
      "agent-readability.json",
      "robots.txt/openapi.json",
      ".well-known/api-catalog/openapi.json",
      ".well-known/agent-card.json",
      ".well-known/agent-skills/index.json",
      "docs/search-index.json",
      "api?/openapi.json",
      "api#/openapi.json",
      "  ",
    ];
    for (const output of rejected) {
      expect(() => resolveNlwebOpenApiConfig({ output })).toThrow(
        /agents\.nlweb\.openapi\.output/
      );
    }
  });

  it("rejects Windows reserved device names on every platform", () => {
    for (const output of [
      "CON/openapi.json",
      "api/AuX.json",
      "api/com1.data/openapi.json",
      "Lpt9.JSON",
    ]) {
      expect(() => resolveNlwebOpenApiConfig({ output })).toThrow(
        /Windows reserved device-name segment/
      );
    }

    for (const output of [
      "console/openapi.json",
      "api/com0.json",
      "api/com10.json",
    ]) {
      expect(() => resolveNlwebOpenApiConfig({ output })).not.toThrow();
    }

    expect(() => resolveNlwebOpenApiConfig({ url: "/api/cOn.json" })).toThrow(
      /Windows reserved device-name segment/
    );
  });

  it("rejects a public URL that is neither rooted nor absolute", () => {
    expect(() => resolveNlwebOpenApiConfig({ url: "openapi.json" })).toThrow(
      /must be a root-relative path/
    );
    expect(() =>
      resolveNlwebOpenApiConfig({ url: "/../openapi.json" })
    ).toThrow(/".." segments/);
    expect(() =>
      resolveNlwebOpenApiConfig({ url: "/%2e%2e/openapi.json" })
    ).toThrow(/".." segments, including percent-encoded segments/);
    expect(() =>
      resolveNlwebOpenApiConfig({ url: "/api/%2e/openapi.json" })
    ).toThrow(/"." segments, including percent-encoded segments/);
    expect(() =>
      resolveNlwebOpenApiConfig({ url: "/api/%ZZ/openapi.json" })
    ).toThrow(/malformed percent escape/);
    expect(() =>
      resolveNlwebOpenApiConfig({ url: "/api\\openapi.json" })
    ).toThrow(/must not contain backslashes/);
    expect(() =>
      resolveNlwebOpenApiConfig({ url: "/api/openapi.json\n" })
    ).toThrow(/must not contain ASCII control characters/);
    expect(() => resolveNlwebOpenApiConfig({ url: "/%6dcp.json" })).toThrow(
      /generated "mcp\.json" artifact/
    );
    for (const url of ["/api%2Fv1/openapi.json", "/api%5Cv1/openapi.json"]) {
      expect(() => resolveNlwebOpenApiConfig({ url })).toThrow(
        /percent-encoded path separators/
      );
    }
    expect(() =>
      resolveNlwebOpenApiConfig({ url: "/api/%00/openapi.json" })
    ).toThrow(/percent-encoded ASCII control characters/);
    expect(() =>
      resolveNlwebOpenApiConfig({ url: "/api/%FF/openapi.json" })
    ).toThrow(/valid UTF-8 percent escapes/);
    expect(() =>
      resolveNlwebOpenApiConfig({ url: "https://cdn.example.com" })
    ).toThrow(/does not name a file/);
    expect(() =>
      resolveNlwebOpenApiConfig({
        url: "//cdn.example.com/openapi.json",
      })
    ).toThrow(/must not be protocol-relative/);
    expect(() =>
      resolveNlwebOpenApiConfig({
        url: "https://%",
        output: "openapi.json",
      })
    ).toThrow(/agents\.nlweb\.openapi\.url.*malformed percent escape/);
    for (const url of [
      "https://user:secret@cdn.example/openapi.json",
      "https://user@cdn.example/openapi.json",
      "https://:secret@cdn.example/openapi.json",
    ]) {
      expect(() => resolveNlwebOpenApiConfig({ url })).toThrow(
        /agents\.nlweb\.openapi\.url.*must not include a username or password/
      );
    }
    expect(() =>
      resolveNlwebOpenApiConfig({
        url: "https://cdn.example/users/user@example.com/openapi.json",
      })
    ).not.toThrow();
  });

  it("revalidates output paths at the exported writer boundary", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "leadtype-nlweb-writer-"));
    try {
      await expect(
        writeAskOpenApiDocument({
          outDir,
          output: "../openapi.json",
          document: buildAskOpenApiDocument({ product }),
        })
      ).rejects.toThrow(/must not contain "\." or "\.\." segments/);
      await expect(
        writeAskOpenApiDocument({
          outDir,
          output: "api%20spec/openapi.json",
          document: buildAskOpenApiDocument({ product }),
        })
      ).rejects.toThrow(/must not contain percent escapes/);
      await expect(
        writeAskOpenApiDocument({
          outDir,
          output: "api\0/openapi.json",
          document: buildAskOpenApiDocument({ product }),
        })
      ).rejects.toThrow(/output.*must not contain ASCII control characters/);
      await expect(
        writeAskOpenApiDocument({
          outDir,
          output: "api/CoM2.json",
          document: buildAskOpenApiDocument({ product }),
        })
      ).rejects.toThrow(/Windows reserved device-name segment/);
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it("rejects symlinked output parents for writes and tracked cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-symlink-"));
    const outDir = join(root, "public");
    const externalDir = join(root, "external");
    const stateDir = join(root, ".leadtype");
    const externalFile = join(externalDir, "openapi.json");
    try {
      await mkdir(outDir, { recursive: true });
      await mkdir(externalDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await symlink(
        externalDir,
        join(outDir, "api"),
        process.platform === "win32" ? "junction" : "dir"
      );

      await expect(
        writeAskOpenApiDocument({
          outDir,
          output: "api/openapi.json",
          document: buildAskOpenApiDocument({ product }),
        })
      ).rejects.toThrow(/outside the physical output root/);
      await expect(readFile(externalFile, "utf8")).rejects.toThrow();

      const handAuthored = '{"handAuthored":true}\n';
      await writeFile(externalFile, handAuthored);
      await writeFile(
        join(stateDir, "nlweb.json"),
        `${JSON.stringify({
          version: 2,
          outDir,
          openapiOutput: "api/openapi.json",
        })}\n`
      );
      await expect(
        generateNlwebArtifacts({
          outDir,
          stateDir,
          product,
          pages: docs.map(pageFor),
          openapi: { enabled: false },
        })
      ).rejects.toThrow(/outside the physical output root/);
      await expect(readFile(externalFile, "utf8")).resolves.toBe(handAuthored);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("withNlwebApiCatalogEntry", () => {
  const entry = nlwebApiCatalogEntry({
    openapiUrl: "/openapi.json",
    docsUrl: "https://leadtype.dev/docs",
  });

  it("describes /ask with the OpenAPI document as its service-desc", () => {
    expect(entry).toMatchObject({
      href: "/ask",
      title: NLWEB_API_CATALOG_TITLE,
      type: "application/json",
      version: NLWEB_PROTOCOL_VERSION,
      serviceDesc: { href: "/openapi.json", type: NLWEB_OPENAPI_MEDIA_TYPE },
    });
  });

  it("adds the endpoint to a catalog that does not list it", () => {
    const apis = withNlwebApiCatalogEntry(
      [{ href: "https://api.leadtype.dev/v1/search" }],
      entry
    );
    expect(apis.map((api) => api.href)).toEqual([
      "https://api.leadtype.dev/v1/search",
      "/ask",
    ]);
  });

  it("fills in a missing service-desc on the site's own entry", () => {
    const apis = withNlwebApiCatalogEntry(
      [{ href: "ask", title: "Site owned" }],
      entry
    );
    expect(apis).toHaveLength(1);
    expect(apis[0]).toMatchObject({
      href: "ask",
      title: "Site owned",
      serviceDesc: { href: "/openapi.json" },
    });
  });

  it("fills in an empty service-desc list", () => {
    expect(
      withNlwebApiCatalogEntry([{ href: "/ask", serviceDesc: [] }], entry)
    ).toEqual([{ href: "/ask", serviceDesc: entry.serviceDesc }]);
  });

  it("never overwrites a service-desc the site declared", () => {
    const declared = [
      { href: "/ask", serviceDesc: { href: "/custom-openapi.json" } },
    ];
    expect(withNlwebApiCatalogEntry(declared, entry)).toEqual(declared);
  });

  it("deduplicates absolute and root-relative endpoints against the site base", () => {
    const authored = [{ href: "https://leadtype.dev/ask", title: "Authored" }];
    expect(
      withNlwebApiCatalogEntry(authored, entry, "https://leadtype.dev")
    ).toEqual([{ ...authored[0], serviceDesc: entry.serviceDesc }]);
  });

  it("keeps trailing-slash-distinct endpoints separate", () => {
    const slashEntry = { ...entry, href: "/ask/" };
    expect(withNlwebApiCatalogEntry([{ href: "/ask" }], slashEntry)).toEqual([
      { href: "/ask" },
      slashEntry,
    ]);
    expect(withNlwebApiCatalogEntry([{ href: "/ask/" }], entry)).toEqual([
      { href: "/ask/" },
      entry,
    ]);
  });

  it("can catalog /ask without an OpenAPI service-desc", () => {
    expect(nlwebApiCatalogEntry({})).not.toHaveProperty("serviceDesc");
  });

  it("rejects credentials in a directly constructed endpoint", () => {
    expect(() =>
      nlwebApiCatalogEntry({
        askEndpoint: "https://user:pass@api.example/ask",
      })
    ).toThrow(/askEndpoint.*must not include a username or password/);
  });

  it("keeps a configured trailing slash in the catalog and OpenAPI path", () => {
    const askEndpoint = "/ask/";
    expect(nlwebApiCatalogEntry({ askEndpoint }).href).toBe(askEndpoint);
    expect(
      Object.keys(buildAskOpenApiDocument({ product, askEndpoint }).paths)
    ).toEqual([askEndpoint]);
  });
});

describe("generateNlwebArtifacts openapi document", () => {
  async function generateInto(
    openapi?: Parameters<typeof generateNlwebArtifacts>[0]["openapi"]
  ) {
    const outDir = await mkdtemp(join(tmpdir(), "leadtype-nlweb-openapi-"));
    const result = await generateNlwebArtifacts({
      outDir,
      baseUrl: "https://leadtype.dev",
      product,
      pages: docs.map(pageFor),
      askEndpoint: "/ask",
      docsUrl: "https://leadtype.dev/docs/reference/nlweb",
      ...(openapi ? { openapi } : {}),
    });
    return { outDir, result };
  }

  it("writes the document at the default public path", async () => {
    const { outDir, result } = await generateInto();
    try {
      expect(result.openapiUrl).toBe("/openapi.json");
      expect(result.files.openapi).toBe(join(outDir, "openapi.json"));
      const document = JSON.parse(
        await readFile(join(outDir, "openapi.json"), "utf8")
      ) as AskOpenApiDocument;
      expect(document.openapi.startsWith("3.1")).toBe(true);
      expect(Object.keys(document.paths)).toEqual(["/ask"]);
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it("honours a configured URL and creates the directories it needs", async () => {
    const { outDir, result } = await generateInto({ url: "/api/openapi.json" });
    try {
      expect(result.openapiUrl).toBe("/api/openapi.json");
      expect(result.files.openapi).toBe(join(outDir, "api", "openapi.json"));
      await expect(
        readFile(join(outDir, "api", "openapi.json"), "utf8")
      ).resolves.toContain("nlwebAskGet");
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it("keeps dormant settings inert when the document is turned off", async () => {
    const { outDir, result } = await generateInto({
      enabled: false,
      output: "../openapi.json",
    });
    try {
      expect(result.files.openapi).toBeUndefined();
      expect(result.openapiUrl).toBeUndefined();
      await expect(
        readFile(join(outDir, "openapi.json"), "utf8")
      ).rejects.toThrow();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });

  it("never removes an untracked OpenAPI document", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-owned-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    try {
      await mkdir(outDir, { recursive: true });
      const openapiFile = join(outDir, "openapi.json");
      await writeFile(openapiFile, '{"handAuthored":true}\n');
      await generateNlwebArtifacts({
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
        openapi: { enabled: false },
      });
      await expect(readFile(openapiFile, "utf8")).resolves.toBe(
        '{"handAuthored":true}\n'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("refuses to overwrite an occupied output without ownership state", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-untracked-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    const handAuthored = '{"handAuthored":true}\n';
    try {
      await mkdir(outDir, { recursive: true });
      await writeFile(openapiFile, handAuthored);

      await expect(
        generateNlwebArtifacts({
          outDir,
          stateDir,
          product,
          pages: docs.map(pageFor),
        })
      ).rejects.toThrow(/already exists and is not owned/);
      await expect(readFile(openapiFile, "utf8")).resolves.toBe(handAuthored);
      await expect(readFile(join(stateDir, "nlweb.json"))).rejects.toThrow();

      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, "nlweb.json"), "not json\n");
      await expect(
        generateNlwebArtifacts({
          outDir,
          stateDir,
          product,
          pages: docs.map(pageFor),
        })
      ).rejects.toThrow(/already exists and is not owned/);
      await expect(readFile(openapiFile, "utf8")).resolves.toBe(handAuthored);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("adopts a matching generated output when ownership state is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-adopt-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    try {
      await writeAskOpenApiDocument({
        outDir,
        output: "openapi.json",
        document: buildAskOpenApiDocument({ product }),
      });
      const originalContents = await readFile(openapiFile);
      const originalInfo = await stat(openapiFile);

      await generateNlwebArtifacts({
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      });

      const generatedContents = await readFile(openapiFile);
      const generatedInfo = await stat(openapiFile);
      const state = JSON.parse(
        await readFile(join(stateDir, "nlweb.json"), "utf8")
      ) as { outputs: { openapiSha256: string }[] };
      expect(state.outputs[0]?.openapiSha256).toBe(
        createHash("sha256").update(generatedContents).digest("hex")
      );
      expect(generatedContents).toEqual(originalContents);
      expect(generatedInfo.ino).toBe(originalInfo.ino);
      expect(generatedInfo.mtimeMs).toBe(originalInfo.mtimeMs);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("updates a stateless generated document but preserves tampering", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-stateless-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    const stateFile = join(stateDir, "nlweb.json");
    try {
      await mkdir(stateDir);
      await chmod(stateDir, 0o500);
      const config = {
        outDir,
        stateDir,
        product: { ...product, name: "First product" },
        pages: docs.map(pageFor),
      };

      await generateNlwebArtifacts(config);
      await generateNlwebArtifacts({
        ...config,
        product: { ...product, name: "Second product" },
      });
      await expect(readFile(openapiFile, "utf8")).resolves.toContain(
        "Second product"
      );
      await expect(readFile(stateFile, "utf8")).rejects.toThrow();

      const generatedContents = await readFile(openapiFile, "utf8");
      const reformattedContents = ` ${generatedContents}`;
      await writeFile(openapiFile, reformattedContents);
      await expect(
        generateNlwebArtifacts({
          ...config,
          product: { ...product, name: "Third product" },
        })
      ).rejects.toThrow(/already exists and is not owned/);
      await expect(readFile(openapiFile, "utf8")).resolves.toBe(
        reformattedContents
      );

      const tampered = JSON.parse(generatedContents) as {
        info: { title: string };
      };
      tampered.info.title = "Hand-edited contract";
      const tamperedContents = `${JSON.stringify(tampered, null, 2)}\n`;
      await writeFile(openapiFile, tamperedContents);

      await expect(
        generateNlwebArtifacts({
          ...config,
          product: { ...product, name: "Third product" },
        })
      ).rejects.toThrow(/already exists and is not owned/);
      await expect(readFile(openapiFile, "utf8")).resolves.toBe(
        tamperedContents
      );
    } finally {
      await chmod(stateDir, 0o700).catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("updates a marked document when readable ownership state is stale", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-stale-ro-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    const stateFile = join(stateDir, "nlweb.json");
    try {
      const config = {
        outDir,
        stateDir,
        product: { ...product, name: "First product" },
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts(config);
      const originalState = await readFile(stateFile, "utf8");
      await chmod(stateDir, 0o500);

      await generateNlwebArtifacts({
        ...config,
        product: { ...product, name: "Second product" },
      });
      await generateNlwebArtifacts({
        ...config,
        product: { ...product, name: "Third product" },
      });

      await expect(readFile(openapiFile, "utf8")).resolves.toContain(
        "Third product"
      );
      await expect(readFile(stateFile, "utf8")).resolves.toBe(originalState);
    } finally {
      await chmod(stateDir, 0o700).catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("removes a document from a previous enabled run", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-cleanup-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    try {
      const config = {
        outDir,
        stateDir,
        baseUrl: "https://leadtype.dev",
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts(config);
      await expect(
        readFile(join(outDir, "openapi.json"), "utf8")
      ).resolves.toContain("nlwebAskGet");
      await expect(
        readFile(join(stateDir, "nlweb.json"), "utf8")
      ).resolves.toContain('"openapiOutput": "openapi.json"');
      await expect(
        readFile(join(outDir, ".leadtype", "nlweb.json"), "utf8")
      ).rejects.toThrow();
      await generateNlwebArtifacts({
        ...config,
        openapi: { enabled: false },
      });
      await expect(
        readFile(join(outDir, "openapi.json"), "utf8")
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves a replaced document when OpenAPI is disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-disable-retry-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    const stateFile = join(stateDir, "nlweb.json");
    try {
      const config = {
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts(config);
      await rm(openapiFile, { force: true });
      await mkdir(openapiFile);
      await writeFile(join(openapiFile, "blocker"), "owned directory\n");

      await generateNlwebArtifacts({
        ...config,
        openapi: { enabled: false },
      });
      await expect(
        readFile(join(openapiFile, "blocker"), "utf8")
      ).resolves.toBe("owned directory\n");
      await expect(readFile(stateFile, "utf8")).resolves.not.toContain(
        '"openapiOutput"'
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("refuses to overwrite a replaced document at the tracked path", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-replaced-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    const replacement = '{"handAuthored":true}\n';
    try {
      const config = {
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts(config);
      await writeFile(openapiFile, replacement);

      await expect(generateNlwebArtifacts(config)).rejects.toThrow(
        /no longer matches the generated file/
      );
      await expect(readFile(openapiFile, "utf8")).resolves.toBe(replacement);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("recovers when generated bytes were written before ownership state", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-stale-state-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    const stateFile = join(stateDir, "nlweb.json");
    try {
      const config = {
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts(config);
      const staleState = JSON.parse(await readFile(stateFile, "utf8")) as {
        outputs: { openapiSha256: string }[];
      };
      const trackedOutput = staleState.outputs[0];
      if (!trackedOutput) {
        throw new Error("Expected generated NLWeb ownership state.");
      }
      trackedOutput.openapiSha256 = "0".repeat(64);
      await writeFile(stateFile, `${JSON.stringify(staleState)}\n`);

      await generateNlwebArtifacts(config);

      const generatedContents = await readFile(openapiFile);
      const repairedState = JSON.parse(await readFile(stateFile, "utf8")) as {
        outputs: { openapiSha256: string }[];
      };
      expect(repairedState.outputs[0]?.openapiSha256).toBe(
        createHash("sha256").update(generatedContents).digest("hex")
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("honors NLWeb state lock timeout and opt-out controls", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-lock-env-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const lockPath = generateLockPath(
      join(await realpath(root), ".leadtype", "nlweb.json")
    );
    const previousNoLock = process.env.LEADTYPE_NO_LOCK;
    const previousLockTimeout = process.env.LEADTYPE_LOCK_TIMEOUT_MS;
    try {
      await mkdir(lockPath);
      await writeFile(
        join(lockPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid })}\n`
      );
      process.env.LEADTYPE_LOCK_TIMEOUT_MS = "1";
      const config = {
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      };

      await expect(generateNlwebArtifacts(config)).rejects.toThrow(
        /timed out .* waiting for another `leadtype generate` run/
      );

      process.env.LEADTYPE_NO_LOCK = "1";
      await expect(generateNlwebArtifacts(config)).resolves.toEqual(
        expect.objectContaining({
          files: expect.objectContaining({
            openapi: join(outDir, "openapi.json"),
          }),
        })
      );
    } finally {
      if (previousNoLock === undefined) {
        delete process.env.LEADTYPE_NO_LOCK;
      } else {
        process.env.LEADTYPE_NO_LOCK = previousNoLock;
      }
      if (previousLockTimeout === undefined) {
        delete process.env.LEADTYPE_LOCK_TIMEOUT_MS;
      } else {
        process.env.LEADTYPE_LOCK_TIMEOUT_MS = previousLockTimeout;
      }
      await rm(lockPath, { force: true, recursive: true });
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not trust legacy state to delete a document", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-legacy-state-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    const replacement = '{"handAuthored":true}\n';
    try {
      await mkdir(outDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(openapiFile, replacement);
      await writeFile(
        join(stateDir, "nlweb.json"),
        `${JSON.stringify({
          version: 3,
          outputs: [
            {
              outDir,
              openapiOutput: "openapi.json",
              openapiSha256: createHash("sha256")
                .update(replacement)
                .digest("hex"),
            },
          ],
        })}\n`
      );

      await generateNlwebArtifacts({
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
        openapi: { enabled: false },
      });

      await expect(readFile(openapiFile, "utf8")).resolves.toBe(replacement);
      await expect(
        readFile(join(stateDir, "nlweb.json"), "utf8")
      ).resolves.not.toContain('"openapiOutput"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed on an invalid v4 ownership fingerprint", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-invalid-state-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    const replacement = '{"handAuthored":true}\n';
    try {
      await mkdir(outDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });
      await writeFile(openapiFile, replacement);
      await writeFile(
        join(stateDir, "nlweb.json"),
        `${JSON.stringify({
          version: 4,
          outputs: [
            {
              outDir,
              openapiOutput: "openapi.json",
              openapiSha256: "invalid",
            },
          ],
        })}\n`
      );

      await expect(
        generateNlwebArtifacts({
          outDir,
          stateDir,
          product,
          pages: docs.map(pageFor),
        })
      ).rejects.toThrow(/no longer matches the generated file/);
      await expect(readFile(openapiFile, "utf8")).resolves.toBe(replacement);

      await writeAskOpenApiDocument({
        outDir,
        output: "openapi.json",
        document: buildAskOpenApiDocument({ product }),
      });
      await generateNlwebArtifacts({
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      });
      await expect(
        readFile(join(stateDir, "nlweb.json"), "utf8")
      ).resolves.toMatch(/"openapiSha256": "[a-f0-9]{64}"/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rolls back when tracked ownership state cannot be updated", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-state-write-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    const stateFile = join(stateDir, "nlweb.json");
    try {
      const config = {
        outDir,
        stateDir,
        product: { ...product, name: "First product" },
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts(config);
      const markedDocument = JSON.parse(
        await readFile(openapiFile, "utf8")
      ) as AskOpenApiDocument;
      const { "x-leadtype-generated": _, ...unmarkedDocument } = markedDocument;
      const original = `${JSON.stringify(unmarkedDocument, null, 2)}\n`;
      await writeFile(openapiFile, original);
      const state = JSON.parse(await readFile(stateFile, "utf8")) as {
        outputs: { openapiSha256: string }[];
      };
      const trackedOutput = state.outputs[0];
      if (!trackedOutput) {
        throw new Error("Expected generated NLWeb ownership state.");
      }
      trackedOutput.openapiSha256 = createHash("sha256")
        .update(original)
        .digest("hex");
      await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
      await chmod(stateDir, 0o500);

      await expect(
        generateNlwebArtifacts({
          ...config,
          product: { ...product, name: "Second product" },
        })
      ).rejects.toThrow(/could not update NLWeb ownership state/);
      await expect(readFile(openapiFile, "utf8")).resolves.toBe(original);

      await chmod(stateDir, 0o700);
      await generateNlwebArtifacts({
        ...config,
        product: { ...product, name: "Second product" },
      });
      await expect(readFile(openapiFile, "utf8")).resolves.toContain(
        "Second product"
      );
    } finally {
      await chmod(stateDir, 0o700).catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not orphan a moved output when ownership state is read-only", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-move-state-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const previousFile = join(outDir, "v1", "openapi.json");
    const nextFile = join(outDir, "v2", "openapi.json");
    try {
      const config = {
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "v1/openapi.json" },
      });
      await chmod(stateDir, 0o500);

      await expect(
        generateNlwebArtifacts({
          ...config,
          openapi: { output: "v2/openapi.json" },
        })
      ).rejects.toThrow(/could not update NLWeb ownership state/);
      await expect(readFile(previousFile, "utf8")).resolves.toContain(
        "nlwebAskGet"
      );
      await expect(readFile(nextFile, "utf8")).rejects.toThrow();

      await chmod(stateDir, 0o700);
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "v2/openapi.json" },
      });
      await expect(readFile(previousFile, "utf8")).rejects.toThrow();
      await expect(readFile(nextFile, "utf8")).resolves.toContain(
        "nlwebAskGet"
      );
    } finally {
      await chmod(stateDir, 0o700).catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("retains ownership when a tracked document cannot be verified", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-unreadable-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "openapi.json");
    const stateFile = join(stateDir, "nlweb.json");
    try {
      const config = {
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts(config);
      await chmod(openapiFile, 0o000);

      await generateNlwebArtifacts({
        ...config,
        openapi: { enabled: false },
      });
      await expect(readFile(stateFile, "utf8")).resolves.toContain(
        '"openapiOutput": "openapi.json"'
      );

      await chmod(openapiFile, 0o600);
      await generateNlwebArtifacts({
        ...config,
        openapi: { enabled: false },
      });
      await expect(readFile(openapiFile, "utf8")).rejects.toThrow();
    } finally {
      await chmod(openapiFile, 0o600).catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves a replaced document that blocks a path-shape move", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-shape-owner-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const openapiFile = join(outDir, "api.json");
    const replacement = '{"handAuthored":true}\n';
    try {
      const config = {
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "api.json" },
      });
      await writeFile(openapiFile, replacement);

      await expect(
        generateNlwebArtifacts({
          ...config,
          openapi: { output: "api.json/openapi.json" },
        })
      ).rejects.toThrow(/no longer matches the generated file/);
      await expect(readFile(openapiFile, "utf8")).resolves.toBe(replacement);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("removes the previous document when its output moves", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-move-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    try {
      const config = {
        outDir,
        stateDir,
        baseUrl: "https://leadtype.dev",
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "v1/openapi.json" },
      });
      await expect(
        readFile(join(outDir, "v1", "openapi.json"), "utf8")
      ).resolves.toContain("nlwebAskGet");

      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "v2/openapi.json" },
      });
      await expect(
        readFile(join(outDir, "v2", "openapi.json"), "utf8")
      ).resolves.toContain("nlwebAskGet");
      await expect(
        readFile(join(outDir, "v1", "openapi.json"), "utf8")
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("recovers interrupted output moves before and after old-file removal", async () => {
    for (const previousFileRemains of [true, false]) {
      const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-move-crash-"));
      const outDir = join(root, "public");
      const stateDir = join(root, ".leadtype");
      const previousOutput = "v1/openapi.json";
      const nextOutput = "v2/openapi.json";
      const previousFile = join(outDir, previousOutput);
      const nextFile = join(outDir, nextOutput);
      try {
        const config = {
          outDir,
          stateDir,
          product,
          pages: docs.map(pageFor),
        };
        await generateNlwebArtifacts({
          ...config,
          openapi: { output: previousOutput },
        });
        await writeAskOpenApiDocument({
          outDir,
          output: nextOutput,
          document: buildAskOpenApiDocument({ product }),
        });
        if (!previousFileRemains) {
          await rm(previousFile);
        }
        const nextInfoBeforeRecovery = await stat(nextFile);

        await generateNlwebArtifacts({
          ...config,
          openapi: { output: nextOutput },
        });

        await expect(readFile(previousFile, "utf8")).rejects.toThrow();
        await expect(readFile(nextFile, "utf8")).resolves.toContain(
          "nlwebAskGet"
        );
        expect((await stat(nextFile)).ino).toBe(nextInfoBeforeRecovery.ino);
        await expect(
          readFile(join(stateDir, "nlweb.json"), "utf8")
        ).resolves.toContain(`"openapiOutput": "${nextOutput}"`);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });

  it("refuses to overwrite an unowned destination when output moves", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-move-occupied-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const previousOutput = "v1/openapi.json";
    const nextOutput = "v2/openapi.json";
    const previousFile = join(outDir, previousOutput);
    const nextFile = join(outDir, nextOutput);
    const stateFile = join(stateDir, "nlweb.json");
    const handAuthored = '{"handAuthored":true}\n';
    try {
      const config = {
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: previousOutput },
      });
      const previousContents = await readFile(previousFile, "utf8");
      await mkdir(join(outDir, "v2"), { recursive: true });
      await writeFile(nextFile, handAuthored);

      await expect(
        generateNlwebArtifacts({
          ...config,
          openapi: { output: nextOutput },
        })
      ).rejects.toThrow(/destination.*already exists.*not owned/);
      await expect(readFile(previousFile, "utf8")).resolves.toBe(
        previousContents
      );
      await expect(readFile(nextFile, "utf8")).resolves.toBe(handAuthored);
      await expect(readFile(stateFile, "utf8")).resolves.toContain(
        `"openapiOutput": "${previousOutput}"`
      );
      await expect(readFile(stateFile, "utf8")).resolves.not.toContain(
        `"openapiOutput": "${nextOutput}"`
      );

      await rm(nextFile);
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: nextOutput },
      });
      await expect(readFile(previousFile, "utf8")).rejects.toThrow();
      await expect(readFile(nextFile, "utf8")).resolves.toContain(
        "nlwebAskGet"
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("retains previous ownership when old-file removal fails", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-move-remove-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const previousDirectory = join(outDir, "v1");
    const previousFile = join(previousDirectory, "openapi.json");
    const nextFile = join(outDir, "v2", "openapi.json");
    const stateFile = join(stateDir, "nlweb.json");
    try {
      const config = {
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "v1/openapi.json" },
      });
      await chmod(previousDirectory, 0o500);

      await expect(
        generateNlwebArtifacts({
          ...config,
          openapi: { output: "v2/openapi.json" },
        })
      ).rejects.toThrow();
      await expect(readFile(previousFile, "utf8")).resolves.toContain(
        "nlwebAskGet"
      );
      await expect(readFile(nextFile, "utf8")).rejects.toThrow();
      await expect(readFile(stateFile, "utf8")).resolves.toContain(
        '"openapiOutput": "v1/openapi.json"'
      );

      await chmod(previousDirectory, 0o700);
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "v2/openapi.json" },
      });
      await expect(readFile(previousFile, "utf8")).rejects.toThrow();
      await expect(readFile(nextFile, "utf8")).resolves.toContain(
        "nlwebAskGet"
      );
    } finally {
      await chmod(previousDirectory, 0o700).catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves a replaced document when the output moves", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-move-retry-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const previousOutput = "v1/openapi.json";
    const nextOutput = "v2/openapi.json";
    const previousFile = join(outDir, previousOutput);
    const stateFile = join(stateDir, "nlweb.json");
    try {
      const config = {
        outDir,
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: previousOutput },
      });
      await rm(previousFile, { force: true });
      await mkdir(previousFile);
      await writeFile(join(previousFile, "blocker"), "owned directory\n");

      await generateNlwebArtifacts({
        ...config,
        openapi: { output: nextOutput },
      });
      await expect(
        readFile(join(previousFile, "blocker"), "utf8")
      ).resolves.toBe("owned directory\n");
      await expect(
        readFile(join(outDir, nextOutput), "utf8")
      ).resolves.toContain("nlwebAskGet");
      await expect(readFile(stateFile, "utf8")).resolves.toContain(
        `"openapiOutput": "${nextOutput}"`
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves the new document when an output move is case-only", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-case-move-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const previousOutput = "api/OpenAPI.json";
    const nextOutput = "api/openapi.json";
    try {
      const config = {
        outDir,
        stateDir,
        baseUrl: "https://leadtype.dev",
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: previousOutput },
      });
      const filesystemTreatsNamesAsEquivalent = await readFile(
        join(outDir, nextOutput),
        "utf8"
      ).then(
        () => true,
        () => false
      );

      await generateNlwebArtifacts({
        ...config,
        openapi: { output: nextOutput },
      });

      await expect(
        readFile(join(outDir, nextOutput), "utf8")
      ).resolves.toContain("nlwebAskGet");
      if (filesystemTreatsNamesAsEquivalent) {
        await expect(
          readFile(join(outDir, previousOutput), "utf8")
        ).resolves.toContain("nlwebAskGet");
      } else {
        await expect(
          readFile(join(outDir, previousOutput), "utf8")
        ).rejects.toThrow();
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("handles filesystem-equivalent ancestor and descendant output moves", async () => {
    for (const [previousOutput, nextOutput] of [
      ["alias/api.json", "real/api.json/openapi.json"],
      ["alias/api.json/openapi.json", "real/api.json"],
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-case-shape-"));
      const outDir = join(root, "public");
      const stateDir = join(root, ".leadtype");
      try {
        const realDir = join(outDir, "real");
        await mkdir(realDir, { recursive: true });
        await symlink(
          realDir,
          join(outDir, "alias"),
          process.platform === "win32" ? "junction" : "dir"
        );
        const config = {
          outDir,
          stateDir,
          product,
          pages: docs.map(pageFor),
        };
        await generateNlwebArtifacts({
          ...config,
          openapi: { output: previousOutput },
        });
        await generateNlwebArtifacts({
          ...config,
          openapi: { output: nextOutput },
        });
        await expect(
          readFile(join(outDir, nextOutput), "utf8")
        ).resolves.toContain("nlwebAskGet");
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });

  it("moves a tracked output from an ancestor file to a nested path", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-nest-move-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    try {
      const config = {
        outDir,
        stateDir,
        baseUrl: "https://leadtype.dev",
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "api.json" },
      });

      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "api.json/openapi.json" },
      });

      await expect(
        readFile(join(outDir, "api.json", "openapi.json"), "utf8")
      ).resolves.toContain("nlwebAskGet");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("moves a tracked nested output to its ancestor file", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-unnest-move-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    try {
      const config = {
        outDir,
        stateDir,
        baseUrl: "https://leadtype.dev",
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "api.json/openapi.json" },
      });

      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "api.json" },
      });

      await expect(
        readFile(join(outDir, "api.json"), "utf8")
      ).resolves.toContain("nlwebAskGet");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("restores a tracked nested output when an unowned sibling blocks its move", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-move-rollback-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    const previousOutput = join(outDir, "api.json", "openapi.json");
    const unownedSibling = join(outDir, "api.json", "keep.txt");
    try {
      const config = {
        outDir,
        stateDir,
        baseUrl: "https://leadtype.dev",
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "api.json/openapi.json" },
      });
      await writeFile(unownedSibling, "keep\n");

      await expect(
        generateNlwebArtifacts({
          ...config,
          openapi: { output: "api.json" },
        })
      ).rejects.toThrow();

      await expect(readFile(previousOutput, "utf8")).resolves.toContain(
        "nlwebAskGet"
      );
      await expect(readFile(unownedSibling, "utf8")).resolves.toBe("keep\n");
      await expect(
        readFile(join(stateDir, "nlweb.json"), "utf8")
      ).resolves.toContain('"openapiOutput": "api.json/openapi.json"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("moves to an ancestor when the tracked old descendant is already missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-stale-move-"));
    const outDir = join(root, "public");
    const stateDir = join(root, ".leadtype");
    try {
      const config = {
        outDir,
        stateDir,
        baseUrl: "https://leadtype.dev",
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "api.json/v1/openapi.json" },
      });
      await rm(join(outDir, "api.json"), { force: true, recursive: true });

      await generateNlwebArtifacts({
        ...config,
        openapi: { output: "api.json" },
      });

      await expect(
        readFile(join(outDir, "api.json"), "utf8")
      ).resolves.toContain("nlwebAskGet");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not remove an unowned old-path document from another output", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-output-owner-"));
    const firstOutDir = join(root, "public-a");
    const secondOutDir = join(root, "public-b");
    const stateDir = join(root, ".leadtype");
    const oldOutput = "v1/openapi.json";
    const handAuthoredDocument = '{"handAuthored":true}\n';
    try {
      const config = {
        stateDir,
        baseUrl: "https://leadtype.dev",
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({
        ...config,
        outDir: firstOutDir,
        openapi: { output: oldOutput },
      });
      await mkdir(join(secondOutDir, "v1"), { recursive: true });
      await writeFile(join(secondOutDir, oldOutput), handAuthoredDocument);

      await generateNlwebArtifacts({
        ...config,
        outDir: secondOutDir,
        openapi: { output: "v2/openapi.json" },
      });

      await expect(
        readFile(join(secondOutDir, oldOutput), "utf8")
      ).resolves.toBe(handAuthoredDocument);
      await expect(
        readFile(join(secondOutDir, "v2/openapi.json"), "utf8")
      ).resolves.toContain("nlwebAskGet");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("tracks cleanup ownership independently for each output root", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-output-states-"));
    const firstOutDir = join(root, "public-a");
    const secondOutDir = join(root, "public-b");
    const sourceDir = join(root, "source");
    const sourceDirAlias = join(root, "source-alias");
    const stateDir = join(sourceDir, ".leadtype");
    const stateDirAlias = join(sourceDirAlias, ".leadtype");
    try {
      await mkdir(sourceDir, { recursive: true });
      await symlink(
        sourceDir,
        sourceDirAlias,
        process.platform === "win32" ? "junction" : "dir"
      );
      const config = {
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await Promise.all([
        generateNlwebArtifacts({ ...config, outDir: firstOutDir }),
        generateNlwebArtifacts({
          ...config,
          stateDir: stateDirAlias,
          outDir: secondOutDir,
        }),
      ]);
      const state = JSON.parse(
        await readFile(join(stateDir, "nlweb.json"), "utf8")
      ) as {
        version: number;
        outputs: { openapiSha256?: string; outDir: string }[];
      };
      expect(state.version).toBe(4);
      expect(state.outputs.map((output) => output.outDir).sort()).toEqual(
        [firstOutDir, secondOutDir].sort()
      );
      for (const output of state.outputs) {
        expect(output.openapiSha256).toMatch(/^[0-9a-f]{64}$/);
      }

      await generateNlwebArtifacts({
        ...config,
        outDir: firstOutDir,
        openapi: { enabled: false },
      });
      await expect(
        readFile(join(firstOutDir, "openapi.json"), "utf8")
      ).rejects.toThrow();
      await expect(
        readFile(join(secondOutDir, "openapi.json"), "utf8")
      ).resolves.toContain("nlwebAskGet");

      await generateNlwebArtifacts({
        ...config,
        outDir: secondOutDir,
        openapi: { enabled: false },
      });
      await expect(
        readFile(join(secondOutDir, "openapi.json"), "utf8")
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("recognizes a tracked output root through a symlink alias", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-root-alias-"));
    const outDir = join(root, "public");
    const outDirAlias = join(root, "public-alias");
    const stateDir = join(root, ".leadtype");
    try {
      await mkdir(outDir, { recursive: true });
      await symlink(
        outDir,
        outDirAlias,
        process.platform === "win32" ? "junction" : "dir"
      );
      const config = {
        stateDir,
        product,
        pages: docs.map(pageFor),
      };
      await generateNlwebArtifacts({ ...config, outDir });
      await generateNlwebArtifacts({
        ...config,
        outDir: outDirAlias,
        openapi: { enabled: false },
      });

      await expect(
        readFile(join(outDir, "openapi.json"), "utf8")
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("is a document leadtype's own OpenAPI reader accepts", async () => {
    // The strongest validation available in-repo: the generated document goes
    // back through the loader that validates, dereferences, and renders every
    // operation of a third-party spec.
    const { outDir } = await generateInto();
    try {
      const [config] = normalizeOpenApiConfig(
        { input: join(outDir, "openapi.json") },
        outDir
      );
      const generated = await generateOpenApiPages(config);
      expect(generated.pages.map((page) => page.operation.operationId)).toEqual(
        ["nlwebAskGet", "nlwebAskPost", "nlwebAskOptions"]
      );
      const get = generated.pages[0]?.operation;
      expect(get?.method).toBe("get");
      expect(get?.path).toBe("/ask");
      expect(get?.parameters.map((parameter) => parameter.name)).toEqual([
        "query",
        "q",
        "query_id",
        "streaming",
      ]);
      expect(get?.responses.map((response) => response.status)).toEqual([
        "200",
        "400",
        "500",
      ]);
      expect(
        generated.pages[1]?.operation.responses.map(
          (response) => response.status
        )
      ).toEqual(["200", "400", "413", "500"]);
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
});
