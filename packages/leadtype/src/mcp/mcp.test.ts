import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const JSON_RPC_INVALID_PARAMS = -32_602;
const JSON_RPC_METHOD_NOT_FOUND = -32_601;

import { runMcpCommand } from "../cli/mcp";
import type {
  AgentReadabilityManifest,
  AgentReadabilityPage,
} from "../llm/readability";
import {
  createDocsSearchIndex,
  type DocsSearchDocument,
  type DocsSearchIndex,
} from "../search/index";
import { type DocsArtifacts, loadDocsArtifacts } from "./artifacts";
import { createMcpServerCard, resolveMcpServerInfo } from "./card";
import { createMcpHandler } from "./http";
import { createDocsMcpServer } from "./server";
import { defineDocsTools } from "./tools";

const QUICKSTART_MARKDOWN = `# Quickstart

Install the package and run leadtype generate.
`;

const docs: DocsSearchDocument[] = [
  {
    id: "quickstart",
    title: "Quickstart",
    description: "Install and configure the package.",
    urlPath: "/docs/guides/quickstart",
    absoluteUrl: "https://leadtype.dev/docs/guides/quickstart",
    relativePath: "guides/quickstart",
    content:
      "# Quickstart\n\nInstall the package. Use CommandTabs to install with pnpm.",
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

function buildArtifacts(): DocsArtifacts {
  const index: DocsSearchIndex = createDocsSearchIndex(docs);
  return {
    index,
    manifest: buildManifest(),
    baseDir: "/virtual",
    // Map the markdown mirror by canonical urlPath.
    readMarkdown: (target) =>
      target.urlPath === "/docs/guides/quickstart" ? QUICKSTART_MARKDOWN : null,
  };
}

async function createArtifactsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "leadtype-mcp-handler-"));
  const docsDir = join(dir, "docs");
  await mkdir(join(docsDir, "guides"), { recursive: true });
  await writeFile(
    join(docsDir, "search-index.json"),
    JSON.stringify(createDocsSearchIndex(docs))
  );
  await writeFile(
    join(docsDir, "agent-readability.json"),
    JSON.stringify(buildManifest())
  );
  await writeFile(
    join(docsDir, "guides", "quickstart.md"),
    QUICKSTART_MARKDOWN
  );
  return dir;
}

function textOf(result: {
  content: { type: string; text?: string }[];
}): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

describe("defineDocsTools", () => {
  const artifacts = buildArtifacts();

  it("exposes search-docs and get-page by default (not list-pages)", () => {
    const names = defineDocsTools(artifacts).map((tool) => tool.name);
    expect(names).toEqual(["search-docs", "get-page"]);
  });

  it("includes list-pages only when requested and drops unknown/dupes", () => {
    const names = defineDocsTools(artifacts, {
      tools: ["list-pages", "search-docs", "search-docs"],
    }).map((tool) => tool.name);
    expect(names).toEqual(["list-pages", "search-docs"]);
  });

  it("search-docs returns ranked { title, urlPath, snippet } hits", async () => {
    const [search] = defineDocsTools(artifacts, { tools: ["search-docs"] });
    const result = await search.handler({ query: "quickstart" });
    expect(result.isError).toBeFalsy();
    const hits = JSON.parse(textOf(result)) as {
      title: string;
      urlPath: string;
      snippet: string;
    }[];
    expect(hits[0].urlPath).toBe("/docs/guides/quickstart");
    expect(hits[0]).toHaveProperty("title");
    expect(hits[0]).toHaveProperty("snippet");
  });

  it("search-docs rejects an empty query as structured input error", async () => {
    const [search] = defineDocsTools(artifacts, { tools: ["search-docs"] });
    await expect(
      Promise.resolve().then(() => search.handler({ query: "   " }))
    ).rejects.toThrow("Invalid input");
  });

  it("search-docs honors the limit", async () => {
    const [search] = defineDocsTools(artifacts, { tools: ["search-docs"] });
    const result = await search.handler({ query: "docs", limit: 1 });
    const hits = JSON.parse(textOf(result)) as unknown[];
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it("get-page returns the markdown mirror for a known page", async () => {
    const [, getPage] = defineDocsTools(artifacts);
    const result = await getPage.handler({
      urlPath: "/docs/guides/quickstart",
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(QUICKSTART_MARKDOWN);
  });

  it("get-page accepts a .md urlPath and trailing variations", async () => {
    const [, getPage] = defineDocsTools(artifacts);
    const result = await getPage.handler({
      urlPath: "/docs/guides/quickstart.md",
    });
    expect(textOf(result)).toBe(QUICKSTART_MARKDOWN);
  });

  it("get-page errors helpfully for an unknown page", async () => {
    const [, getPage] = defineDocsTools(artifacts);
    const result = await getPage.handler({ urlPath: "/docs/nope" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("search-docs");
  });

  it("get-page errors when the mirror is missing on disk", async () => {
    const [, getPage] = defineDocsTools(artifacts);
    // /docs/components/tabs is in the manifest but the reader returns null.
    const result = await getPage.handler({ urlPath: "/docs/components/tabs" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("missing on disk");
  });

  it("list-pages lists every page", async () => {
    const [listPages] = defineDocsTools(artifacts, { tools: ["list-pages"] });
    const result = await listPages.handler({});
    const pages = JSON.parse(textOf(result)) as { urlPath: string }[];
    expect(pages.map((page) => page.urlPath)).toEqual([
      "/docs/guides/quickstart",
      "/docs/components/tabs",
    ]);
  });
});

describe("createDocsMcpServer (in-memory client)", () => {
  it("lists tools and calls them through the real MCP wiring", async () => {
    const server = await createDocsMcpServer({ artifacts: buildArtifacts() });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "get-page",
        "search-docs",
      ]);
      expect(
        (
          tools.find((tool) => tool.name === "search-docs") as
            | {
                annotations?: {
                  idempotentHint?: boolean;
                  readOnlyHint?: boolean;
                };
              }
            | undefined
        )?.annotations
      ).toEqual({
        idempotentHint: true,
        readOnlyHint: true,
      });

      const searchResult = (await client.callTool({
        name: "search-docs",
        arguments: { query: "quickstart" },
      })) as CallToolResult;
      const hits = JSON.parse(
        (searchResult.content[0] as { text: string }).text
      ) as { urlPath: string }[];
      expect(hits[0].urlPath).toBe("/docs/guides/quickstart");

      const pageResult = (await client.callTool({
        name: "get-page",
        arguments: { urlPath: "/docs/guides/quickstart" },
      })) as CallToolResult;
      expect((pageResult.content[0] as { text: string }).text).toBe(
        QUICKSTART_MARKDOWN
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("loadDocsArtifacts (from disk)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "leadtype-mcp-"));
    const docsDir = join(dir, "docs");
    await mkdir(join(docsDir, "guides"), { recursive: true });
    await writeFile(
      join(docsDir, "search-index.json"),
      JSON.stringify(createDocsSearchIndex(docs))
    );
    await writeFile(
      join(docsDir, "agent-readability.json"),
      JSON.stringify(buildManifest())
    );
    await writeFile(
      join(docsDir, "guides", "quickstart.md"),
      QUICKSTART_MARKDOWN
    );
  });

  it("reads index + manifest and get-page serves the .md from disk", async () => {
    const artifacts = await loadDocsArtifacts({ artifacts: dir });
    expect(artifacts.manifest.pages.length).toBe(2);

    const [, getPage] = defineDocsTools(artifacts);
    const result = await getPage.handler({
      urlPath: "/docs/guides/quickstart",
    });
    // Byte-identical to the file on disk — Q2: the .md mirror is the content source.
    expect(textOf(result)).toBe(QUICKSTART_MARKDOWN);
  });

  it("throws a helpful error when artifacts are absent", async () => {
    await expect(loadDocsArtifacts({ artifacts: tmpdir() })).rejects.toThrow(
      /search-index\.json/
    );
  });

  it("`leadtype mcp --check` exercises the tools with no client or SDK", async () => {
    let out = "";
    const io = {
      stderr: { write: () => true },
      stdout: {
        write: (chunk: string) => {
          out += chunk;
          return true;
        },
      },
    };
    const code = await runMcpCommand(
      ["--check", "--artifacts", dir, "--query", "quickstart"],
      io
    );
    expect(code).toBe(0);
    expect(out).toContain("tools: search-docs, get-page");
    expect(out).toContain("/docs/guides/quickstart");
    expect(out).toMatch(/get-page\(.*\): \d+ chars/);
  });
});

describe("createMcpServerCard", () => {
  it("resolves the same default serverInfo the runtime uses", () => {
    expect(
      resolveMcpServerInfo({
        name: "Acme Docs",
        summary: "Acme docs.",
      })
    ).toEqual({
      name: "acme-docs",
      version: "1.0.0",
      description: "Acme docs.",
      instructions: "Search and read the documentation for Acme docs.",
    });
  });

  it("allows overriding the instructions and icon", () => {
    const card = createMcpServerCard({
      baseUrl: "https://leadtype.dev/docs/",
      product: {
        name: "Leadtype",
        summary: "Docs pipeline tooling.",
      },
      config: {
        icon: "https://leadtype.dev/icon.png",
        logo: "https://leadtype.dev/logo.png",
        serverInfo: {
          instructions: "Read the docs before answering.",
        },
      },
    });

    expect(card.icon).toBe("https://leadtype.dev/icon.png");
    expect(card.serverInfo.instructions).toBe(
      "Read the docs before answering."
    );
  });

  it("falls back to logo when icon is not provided", () => {
    const card = createMcpServerCard({
      baseUrl: "https://leadtype.dev/docs/",
      product: {
        name: "Leadtype",
        summary: "Docs pipeline tooling.",
      },
      config: {
        logo: "https://leadtype.dev/logo.png",
      },
    });

    expect(card.icon).toBe("https://leadtype.dev/logo.png");
  });

  it("builds the SEP-1649 discovery card for the docs MCP endpoint", () => {
    const card = createMcpServerCard({
      baseUrl: "https://leadtype.dev/docs/",
      product: {
        name: "Leadtype",
        summary: "Docs pipeline tooling.",
      },
    });

    expect(card).toEqual({
      $schema:
        "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json",
      version: "1.0",
      protocolVersion: "2025-06-18",
      name: "leadtype-docs",
      description: "Docs pipeline tooling.",
      serverUrl: "https://leadtype.dev/docs/mcp",
      tools: [
        {
          name: "search-docs",
          title: "Search documentation",
          description:
            "Search the documentation and return ranked results " +
            "({ title, urlPath, snippet }). Use get-page to read a full result.",
          annotations: {
            idempotentHint: true,
            readOnlyHint: true,
          },
        },
        {
          name: "get-page",
          title: "Get a documentation page",
          description:
            "Return the full Markdown of one documentation page by its urlPath " +
            "(e.g. the urlPath from a search-docs result).",
          annotations: {
            idempotentHint: true,
            readOnlyHint: true,
          },
        },
      ],
      serverInfo: {
        name: "leadtype-docs",
        version: "1.0.0",
        description: "Docs pipeline tooling.",
        instructions:
          "Search and read the documentation for Docs pipeline tooling.",
      },
      transport: {
        type: "streamable-http",
        endpoint: "https://leadtype.dev/docs/mcp",
      },
      capabilities: {
        tools: {},
      },
      authentication: { required: false },
    });
  });

  it("honors endpoint, serverInfo, and authentication overrides", () => {
    const card = createMcpServerCard({
      product: {
        name: "Acme Docs",
        summary: "Acme docs.",
      },
      config: {
        endpoint: "api/mcp",
        serverInfo: {
          name: "acme-docs",
          version: "2.3.4",
          description: "Acme support docs.",
        },
        authentication: {
          required: true,
        },
      },
    });

    expect(card.serverInfo).toEqual({
      name: "acme-docs",
      version: "2.3.4",
      description: "Acme support docs.",
      instructions: "Search and read the documentation for Acme docs.",
    });
    expect(card.transport.endpoint).toBe("/api/mcp");
    // Capabilities are not configurable — the card always advertises tools only.
    expect(card.capabilities).toEqual({ tools: {} });
    expect(card.authentication.required).toBe(true);
  });
});

describe("createMcpHandler error handling", () => {
  const createdDirs: string[] = [];

  async function createTrackedArtifactsDir(): Promise<string> {
    const dir = await createArtifactsDir();
    createdDirs.push(dir);
    return dir;
  }

  afterAll(async () => {
    await Promise.all(
      createdDirs.map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it("returns server instructions during initialize", async () => {
    const artifacts = await createTrackedArtifactsDir();
    const handler = createMcpHandler({
      artifacts,
      serverInfo: {
        instructions: "Read the docs before answering.",
      },
    });
    const response = await handler(
      new Request("https://app.local/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "x", version: "0" },
          },
        }),
      })
    );

    const body = (await response.json()) as {
      result?: { instructions?: string };
    };
    expect(body.result?.instructions).toBe("Read the docs before answering.");
  });

  it("returns a structured JSON-RPC error for invalid tool input", async () => {
    const artifacts = await createTrackedArtifactsDir();
    const handler = createMcpHandler({ artifacts });
    const response = await handler(
      new Request("https://app.local/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "search-docs",
            arguments: { query: "   " },
          },
        }),
      })
    );

    const body = (await response.json()) as {
      error?: { code?: number; message?: string };
    };
    expect(body.error?.code).toBe(JSON_RPC_INVALID_PARAMS);
    expect(body.error?.message).toContain("Invalid input");
  });

  it("returns a structured JSON-RPC error for unknown tools", async () => {
    const artifacts = await createTrackedArtifactsDir();
    const handler = createMcpHandler({ artifacts });
    const response = await handler(
      new Request("https://app.local/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "not-a-tool",
            arguments: {},
          },
        }),
      })
    );

    const body = (await response.json()) as {
      error?: { code?: number; message?: string };
    };
    expect(body.error?.code).toBe(JSON_RPC_METHOD_NOT_FOUND);
    expect(body.error?.message).toContain("Unknown tool");
  });

  it("returns a JSON-RPC 500 (never throws) when artifacts can't load", async () => {
    const handler = createMcpHandler({ artifacts: tmpdir() });
    const response = await handler(
      new Request("https://app.local/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "x", version: "0" },
          },
        }),
      })
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/search-index\.json/);
  });
});
