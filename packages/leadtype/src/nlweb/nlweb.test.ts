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
  docsSearchDefaults,
} from "../search/index";
import { generateNlwebArtifacts } from "./artifacts";
import {
  createAskHandler,
  NLWEB_ERROR_CODES,
  NLWEB_PROTOCOL_VERSION,
  type NlwebAskFailure,
  type NlwebAskResponse,
} from "./ask";

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
});
