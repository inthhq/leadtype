import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AgentReadabilityManifest,
  createApiCatalogResponse,
} from "../llm/readability";
import type { AskOpenApiDocument } from "../nlweb/openapi";
import { runGenerateCommand } from "./generate";

type GenerateJson = {
  files: { nlwebOpenapi?: string; apiCatalog?: string };
};

type CatalogLinkset = {
  linkset: {
    anchor: string;
    item?: { href: string; title?: string }[];
    "service-desc"?: { href: string; type?: string }[];
  }[];
};

const BASE_URL = "https://leadtype.dev";
const SUBPATH_BASE_URL = `${BASE_URL}/docs`;
const BASE_URL_ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_VERCEL_URL",
  "VERCEL_URL",
  "PORTLESS_URL",
] as const;
const silentIo = {
  stderr: { write: () => true },
  stdout: { write: () => true },
};

describe("generate --base-url with agents.nlweb enabled", () => {
  let root: string;
  let outDir: string;
  let stdout: string;
  let exitCode: number;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-generate-"));
    outDir = join(root, "public");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "docs", "quickstart.mdx"),
      [
        "---",
        "title: Quickstart",
        "description: Install and configure the package.",
        "---",
        "",
        "# Quickstart",
        "",
        "Install the package and run the generate command.",
      ].join("\n")
    );
    await writeFile(
      join(root, "docs", "docs.config.mjs"),
      [
        "export default {",
        '  product: { name: "Leadtype", tagline: "Docs pipeline.", docs: "https://leadtype.dev/docs" },',
        "  agents: { nlweb: { enabled: true } },",
        "};",
      ].join("\n")
    );

    let captured = "";
    exitCode = await runGenerateCommand(
      [
        "--src",
        root,
        "--docs-dir",
        "docs",
        "--out",
        outDir,
        "--base-url",
        SUBPATH_BASE_URL,
        "--format",
        "json",
      ],
      {
        stderr: { write: () => true },
        stdout: {
          write: (chunk: string) => {
            captured += chunk;
            return true;
          },
        },
      }
    );
    stdout = captured;
  });

  afterAll(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("emits the OpenAPI document and reports it in the result metadata", async () => {
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as GenerateJson;
    expect(result.files.nlwebOpenapi).toBe(join(outDir, "openapi.json"));

    const document = JSON.parse(
      await readFile(join(outDir, "openapi.json"), "utf8")
    ) as AskOpenApiDocument;
    expect(document.openapi.startsWith("3.1")).toBe(true);
    expect(document.servers?.[0]?.url).toBe(SUBPATH_BASE_URL);
    expect(Object.keys(document.paths)).toEqual(["/ask"]);
    expect(document.externalDocs).toMatchObject({
      url: "https://leadtype.dev/docs",
    });
  });

  it("lists /ask in the API catalog with the document as its service-desc", async () => {
    const catalog = JSON.parse(
      await readFile(join(outDir, ".well-known", "api-catalog"), "utf8")
    ) as CatalogLinkset;

    const [root_, api] = catalog.linkset;
    expect(root_.item).toEqual([
      expect.objectContaining({
        href: `${SUBPATH_BASE_URL}/ask`,
        title: "Documentation query API",
      }),
    ]);
    expect(api.anchor).toBe(`${SUBPATH_BASE_URL}/ask`);
    expect(api["service-desc"]).toEqual([
      expect.objectContaining({
        href: `${SUBPATH_BASE_URL}/openapi.json`,
        type: "application/vnd.oai.openapi+json;version=3.1",
      }),
    ]);
  });
});

describe("generate with agents.nlweb.openapi disabled", () => {
  let root: string;
  let outDir: string;
  let stdout: string;
  let exitCode: number;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-generate-off-"));
    outDir = join(root, "public");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "docs", "quickstart.mdx"),
      [
        "---",
        "title: Quickstart",
        "description: Install and configure the package.",
        "---",
        "",
        "# Quickstart",
      ].join("\n")
    );
    await writeFile(
      join(root, "docs", "docs.config.mjs"),
      [
        "export default {",
        '  product: { name: "Leadtype", tagline: "Docs pipeline." },',
        "  agents: { nlweb: { enabled: true, openapi: { enabled: false } } },",
        "};",
      ].join("\n")
    );

    let captured = "";
    exitCode = await runGenerateCommand(
      [
        "--src",
        root,
        "--docs-dir",
        "docs",
        "--out",
        outDir,
        "--base-url",
        BASE_URL,
        "--format",
        "json",
      ],
      {
        stderr: { write: () => true },
        stdout: {
          write: (chunk: string) => {
            captured += chunk;
            return true;
          },
        },
      }
    );
    stdout = captured;
  });

  afterAll(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("emits no document but still catalogs the enabled endpoint", async () => {
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as GenerateJson;
    expect(result.files.nlwebOpenapi).toBeUndefined();
    expect(result.files.apiCatalog).toBe(
      join(outDir, ".well-known", "api-catalog")
    );
    const catalog = JSON.parse(
      await readFile(join(outDir, ".well-known", "api-catalog"), "utf8")
    ) as CatalogLinkset;
    expect(catalog.linkset[0]?.item).toContainEqual(
      expect.objectContaining({ href: `${BASE_URL}/ask` })
    );
    expect(catalog.linkset[1]?.["service-desc"]).toBeUndefined();
    await expect(
      readFile(join(outDir, "openapi.json"), "utf8")
    ).rejects.toThrow();
  });
});

describe("generate with an environment-derived base URL", () => {
  let root: string;
  let outDir: string;
  let exitCode: number;
  let previousBaseUrl: string | undefined;

  beforeAll(async () => {
    previousBaseUrl = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = SUBPATH_BASE_URL;
    root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-generate-env-"));
    outDir = join(root, "public");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "docs", "quickstart.mdx"),
      "---\ntitle: Quickstart\ndescription: Install.\n---\n# Quickstart\n"
    );
    await writeFile(
      join(root, "docs", "docs.config.mjs"),
      [
        "export default {",
        '  product: { name: "Leadtype", tagline: "Docs pipeline." },',
        "  agents: { mcp: { enabled: true }, nlweb: { enabled: true } },",
        "};",
      ].join("\n")
    );

    exitCode = await runGenerateCommand(
      ["--src", root, "--docs-dir", "docs", "--out", outDir],
      {
        stderr: { write: () => true },
        stdout: { write: () => true },
      }
    );
  });

  afterAll(async () => {
    if (previousBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = previousBaseUrl;
    }
    await rm(root, { force: true, recursive: true });
  });

  it("uses one environment-derived base URL for every NLWeb surface", async () => {
    expect(exitCode).toBe(0);
    const manifest = JSON.parse(
      await readFile(join(outDir, "docs", "agent-readability.json"), "utf8")
    ) as AgentReadabilityManifest;
    expect(manifest.apis?.[0]).toMatchObject({
      href: `${SUBPATH_BASE_URL}/ask`,
      serviceDesc: { href: `${SUBPATH_BASE_URL}/openapi.json` },
    });

    const response = createApiCatalogResponse({
      manifest,
      requestOrigin: "https://docs.leadtype.dev",
    });
    if (!response) {
      throw new Error("Expected the generated manifest to publish an API.");
    }
    const catalog = (await response.json()) as CatalogLinkset;
    expect(catalog.linkset[0]?.item).toEqual([
      expect.objectContaining({
        href: `${SUBPATH_BASE_URL}/ask`,
        title: "Documentation query API",
      }),
    ]);
    expect(catalog.linkset[1]?.["service-desc"]).toEqual([
      expect.objectContaining({
        href: `${SUBPATH_BASE_URL}/openapi.json`,
      }),
    ]);

    const document = JSON.parse(
      await readFile(join(outDir, "openapi.json"), "utf8")
    ) as AskOpenApiDocument;
    expect(document.servers?.[0]?.url).toBe(SUBPATH_BASE_URL);
    expect(Object.keys(document.paths)).toEqual(["/ask"]);
    await expect(readFile(join(outDir, "llms.txt"), "utf8")).resolves.toContain(
      `${SUBPATH_BASE_URL}/ask`
    );
    const llms = await readFile(join(outDir, "llms.txt"), "utf8");
    expect(llms).toContain(`${SUBPATH_BASE_URL}/mcp`);
    expect(llms).toContain(
      `${SUBPATH_BASE_URL}/.well-known/mcp/server-card.json`
    );
    const mcpCard = JSON.parse(
      await readFile(
        join(outDir, ".well-known", "mcp", "server-card.json"),
        "utf8"
      )
    ) as { serverUrl: string; transport: { endpoint: string } };
    expect(mcpCard.serverUrl).toBe(`${SUBPATH_BASE_URL}/mcp`);
    expect(mcpCard.transport.endpoint).toBe(`${SUBPATH_BASE_URL}/mcp`);
  });
});

describe("generate without a publishable base URL", () => {
  it("keeps OpenAPI and schema artifacts relative", async () => {
    const previousEnv = new Map(
      BASE_URL_ENV_KEYS.map((key) => [key, process.env[key]])
    );
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-relative-"));
    const outDir = join(root, "public");
    try {
      for (const key of BASE_URL_ENV_KEYS) {
        delete process.env[key];
      }
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(
        join(root, "docs", "quickstart.mdx"),
        "---\ntitle: Quickstart\ndescription: Install.\n---\n# Quickstart\n"
      );
      await writeFile(
        join(root, "docs", "docs.config.mjs"),
        [
          "export default {",
          '  product: { name: "Leadtype", tagline: "Docs pipeline." },',
          "  agents: { mcp: { enabled: true }, nlweb: { enabled: true } },",
          "};",
        ].join("\n")
      );

      const exitCode = await runGenerateCommand(
        ["--src", root, "--docs-dir", "docs", "--out", outDir],
        silentIo
      );
      expect(exitCode).toBe(0);

      const document = JSON.parse(
        await readFile(join(outDir, "openapi.json"), "utf8")
      ) as AskOpenApiDocument;
      expect(document.servers).toBeUndefined();

      const llms = await readFile(join(outDir, "llms.txt"), "utf8");
      expect(llms).toContain("MCP server (Streamable HTTP): /mcp");
      expect(llms).toContain("NLWeb /ask endpoint: /ask");
      const mcpCard = JSON.parse(
        await readFile(
          join(outDir, ".well-known", "mcp", "server-card.json"),
          "utf8"
        )
      ) as { serverUrl: string; transport: { endpoint: string } };
      expect(mcpCard.serverUrl).toBe("/mcp");
      expect(mcpCard.transport.endpoint).toBe("/mcp");

      const schemaMap = await readFile(join(outDir, "schema-map.xml"), "utf8");
      expect(schemaMap).toContain("<loc>/feeds/schema.jsonl</loc>");

      const [firstSchema = "{}"] = (
        await readFile(join(outDir, "feeds", "schema.jsonl"), "utf8")
      )
        .trim()
        .split("\n");
      expect((JSON.parse(firstSchema) as { url?: string }).url).toBe(
        "/docs/quickstart"
      );
    } finally {
      for (const [key, value] of previousEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not require the source tree to store cleanup state", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "leadtype-nlweb-readonly-state-")
    );
    const outDir = join(root, "public");
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(
        join(root, "docs", "quickstart.mdx"),
        "---\ntitle: Quickstart\ndescription: Install.\n---\n# Quickstart\n"
      );
      await writeFile(
        join(root, "docs", "docs.config.mjs"),
        [
          "export default {",
          '  product: { name: "Leadtype", tagline: "Docs pipeline." },',
          "  agents: { nlweb: { enabled: true } },",
          "};",
        ].join("\n")
      );
      await writeFile(join(root, ".leadtype"), "immutable source marker\n");

      expect(
        await runGenerateCommand(
          ["--src", root, "--docs-dir", "docs", "--out", outDir],
          silentIo
        )
      ).toBe(0);
      await expect(
        readFile(join(outDir, "openapi.json"), "utf8")
      ).resolves.toContain("nlwebAskGet");
      await expect(
        readFile(join(outDir, "schema-map.xml"), "utf8")
      ).resolves.toContain("<schemamap>");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("generate after agents.nlweb is disabled", () => {
  it("removes the previously generated OpenAPI document", async () => {
    const root = await mkdtemp(join(tmpdir(), "leadtype-nlweb-disable-"));
    const outDir = join(root, "public");
    const args = [
      "--src",
      root,
      "--docs-dir",
      "docs",
      "--out",
      outDir,
      "--base-url",
      BASE_URL,
    ];
    try {
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(
        join(root, "docs", "quickstart.mdx"),
        "---\ntitle: Quickstart\ndescription: Install.\n---\n# Quickstart\n"
      );
      await writeFile(
        join(root, "docs", "docs.config.ts"),
        'export default { product: { name: "Leadtype", tagline: "Docs pipeline." }, agents: { nlweb: { enabled: true } } };\n'
      );
      expect(await runGenerateCommand(args, silentIo)).toBe(0);
      expect(await readFile(join(outDir, "openapi.json"), "utf8")).toContain(
        '"openapi"'
      );
      await expect(
        readFile(join(root, ".leadtype", "nlweb.json"), "utf8")
      ).resolves.toContain('"openapiOutput": "openapi.json"');
      await expect(
        readFile(join(outDir, ".leadtype", "nlweb.json"), "utf8")
      ).rejects.toThrow();

      await writeFile(
        join(root, "docs", "docs.config.ts"),
        'export default { product: { name: "Leadtype", tagline: "Docs pipeline." } };\n'
      );
      expect(await runGenerateCommand(args, silentIo)).toBe(0);
      await expect(
        readFile(join(outDir, "openapi.json"), "utf8")
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
