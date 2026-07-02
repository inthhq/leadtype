import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertMdxToMarkdown } from "../convert/convert";
import { defaultMarkdownTransforms } from "../markdown/index";
import {
  buildSchemaExample,
  escapeMarkdownForMdx,
  normalizeOpenApiConfig,
  stageOpenApiDocs,
  validateDocsOpenApiConfig,
  writeOpenApiPages,
} from "./index";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "leadtype-openapi-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { force: true, recursive: true });
    })
  );
});

const FIXTURE_SPEC = `
openapi: 3.1.0
info:
  title: Fixture API
  version: 1.0.0
servers:
  - url: https://api.example.com
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
paths:
  /access-groups/{id}:
    get:
      operationId: readAccessGroup
      summary: Reads an access group
      tags: [Access Groups]
      security:
        - bearer: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
          description: Access group ID.
      responses:
        "200":
          description: The access group.
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id:
                    type: string
                    description: Unique ID.
`;

async function writeFixture(
  dir: string,
  name: string,
  contents: string
): Promise<string> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, contents);
  return filePath;
}

async function generateFixturePages(spec: string, output = "rest-api") {
  const dir = await createTempDir();
  const docsDir = path.join(dir, "docs");
  await mkdir(docsDir, { recursive: true });
  await writeFixture(dir, "openapi.yaml", spec);
  const configs = normalizeOpenApiConfig(
    { input: "openapi.yaml", output },
    dir
  );
  const result = await writeOpenApiPages({ configs, docsDir });
  return { dir, docsDir, result };
}

describe("OpenAPI page generation", () => {
  it("writes native MDX API reference pages and generated nav", async () => {
    const { docsDir, result } = await generateFixturePages(FIXTURE_SPEC);

    expect(result.pages).toHaveLength(1);
    expect(result.nav[0]).toMatchObject({
      base: "rest-api",
      title: "API Reference",
    });

    const pagePath = path.join(
      docsDir,
      "rest-api",
      "access-groups",
      "read-access-group.mdx"
    );
    const page = await readFile(pagePath, "utf8");
    expect(page).toContain('title: "Reads an access group"');
    expect(page).toContain("<ApiEndpoint");
    expect(page).toContain('method="get"');
    expect(page).toContain("<ApiAuth");
    expect(page).toContain("<ApiParameters");
    expect(page).toContain("<ApiResponses");
    expect(page).not.toContain("<ApiTryIt");
    // The docs renderer prints the frontmatter title — no duplicate body h1.
    expect(page).not.toMatch(/^# /m);
  });

  it("flattens generated pages into agent-readable markdown", async () => {
    const { result } = await generateFixturePages(FIXTURE_SPEC);
    const converted = await convertMdxToMarkdown(
      result.pages[0]?.filePath ?? "",
      defaultMarkdownTransforms
    );

    // Every Api* component must flatten — no raw JSX in agent markdown.
    expect(converted.markdown).not.toContain("<Api");
    expect(converted.markdown).toContain("GET /access-groups/{id}");
    expect(converted.markdown).toContain("|Name|Type|Required|Description|");
    expect(converted.markdown).toContain("`id`");
    // Auth header derived from the bearer scheme lands in code samples.
    expect(converted.markdown).toContain("Authorization: Bearer <token>");
    // Synthesized response example from the schema.
    expect(converted.markdown).toContain('"id": "string"');
  });

  it("escapes MDX-unsafe CommonMark descriptions", async () => {
    const spec = `
openapi: 3.1.0
info: { title: Unsafe, version: 1.0.0 }
paths:
  /users/{id}:
    get:
      operationId: readUser
      summary: Read a user
      description: |
        Returns the user for {id}. Set the header to <token> when calling.
      responses:
        "200":
          description: ok
`;
    const { result } = await generateFixturePages(spec);
    const converted = await convertMdxToMarkdown(
      result.pages[0]?.filePath ?? "",
      defaultMarkdownTransforms
    );
    expect(converted.markdown).toContain("{id}");
    expect(converted.markdown).toContain("<token>");
  });

  it("renders nested array item properties as dotted rows", async () => {
    const spec = `
openapi: 3.1.0
info: { title: Nested, version: 1.0.0 }
paths:
  /search:
    post:
      operationId: search
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  results:
                    type: array
                    items:
                      type: object
                      properties:
                        title:
                          type: string
                          description: Result title.
                        nested:
                          type: object
                          properties:
                            deep:
                              type: string
`;
    const { result } = await generateFixturePages(spec);
    const page = await readFile(result.pages[0]?.filePath ?? "", "utf8");
    expect(page).toContain('"name": "title"');

    const converted = await convertMdxToMarkdown(
      result.pages[0]?.filePath ?? "",
      defaultMarkdownTransforms
    );
    expect(converted.markdown).toContain("`results[].title`");
    expect(converted.markdown).toContain("`results[].nested.deep`");
  });

  it("resolves external $refs relative to the spec file", async () => {
    const dir = await createTempDir();
    const docsDir = path.join(dir, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFixture(
      dir,
      "schemas.yaml",
      `
User:
  type: object
  properties:
    name:
      type: string
`
    );
    await writeFixture(
      dir,
      "openapi.yaml",
      `
openapi: 3.1.0
info: { title: Refs, version: 1.0.0 }
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "./schemas.yaml#/User"
`
    );
    const configs = normalizeOpenApiConfig({ input: "openapi.yaml" }, dir);
    const result = await writeOpenApiPages({ configs, docsDir });
    const page = await readFile(result.pages[0]?.filePath ?? "", "utf8");
    expect(page).toContain('"name": "name"');
  });

  it("degrades circular $refs to the referenced type name", async () => {
    const spec = `
openapi: 3.1.0
info: { title: Cycle, version: 1.0.0 }
components:
  schemas:
    Node:
      type: object
      properties:
        children:
          type: array
          items:
            $ref: "#/components/schemas/Node"
paths:
  /nodes:
    get:
      operationId: listNodes
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Node"
`;
    const { result } = await generateFixturePages(spec);
    const page = await readFile(result.pages[0]?.filePath ?? "", "utf8");
    expect(page).toContain('"type": "Node[]"');
  });

  it("filters operations with includeTags and excludeTags", async () => {
    const spec = `
openapi: 3.1.0
info: { title: Tags, version: 1.0.0 }
paths:
  /a:
    get:
      operationId: opA
      tags: [Public]
      responses: { "200": { description: ok } }
  /b:
    get:
      operationId: opB
      tags: [Internal]
      responses: { "200": { description: ok } }
`;
    const dir = await createTempDir();
    const docsDir = path.join(dir, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFixture(dir, "openapi.yaml", spec);
    const configs = normalizeOpenApiConfig(
      {
        excludeTags: ["Internal"],
        includeTags: ["Public", "Internal"],
        input: "openapi.yaml",
      },
      dir
    );
    const result = await writeOpenApiPages({ configs, docsDir });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.operation.operationId).toBe("opA");
  });

  it("supports method-path slugs and suffixes collisions across specs", async () => {
    const spec = `
openapi: 3.1.0
info: { title: Slugs, version: 1.0.0 }
paths:
  /users/{id}:
    get:
      operationId: readUser
      responses: { "200": { description: ok } }
`;
    const dir = await createTempDir();
    const docsDir = path.join(dir, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFixture(dir, "openapi.yaml", spec);
    // Two specs targeting the same output directory must not overwrite.
    const configs = normalizeOpenApiConfig(
      [
        {
          groupByTags: false,
          input: "openapi.yaml",
          output: "api",
          slugStrategy: "method-path",
        },
        {
          groupByTags: false,
          input: "openapi.yaml",
          output: "api",
          slugStrategy: "method-path",
        },
      ],
      dir
    );
    const result = await writeOpenApiPages({ configs, docsDir });
    expect(result.pages.map((page) => page.relativePath).sort()).toEqual([
      "api/get-users-id-2.mdx",
      "api/get-users-id.mdx",
    ]);
  });

  it("prefers x-codeSamples over generated snippets", async () => {
    const spec = `
openapi: 3.1.0
info: { title: Samples, version: 1.0.0 }
paths:
  /things:
    get:
      operationId: listThings
      x-codeSamples:
        - lang: Python
          label: Python SDK
          source: client.things.list()
      responses: { "200": { description: ok } }
`;
    const { result } = await generateFixturePages(spec);
    const samples = result.pages[0]?.operation.codeSamples ?? [];
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      code: "client.things.list()",
      label: "Python SDK",
      language: "python",
    });
  });

  it("builds cURL samples with query params and request bodies", async () => {
    const spec = `
openapi: 3.1.0
info: { title: Curl, version: 1.0.0 }
servers:
  - url: https://api.example.com
paths:
  /search:
    post:
      operationId: search
      parameters:
        - name: limit
          in: query
          required: true
          schema:
            type: integer
            default: 8
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [query]
              properties:
                query:
                  type: string
      responses: { "200": { description: ok } }
`;
    const { result } = await generateFixturePages(spec);
    const curl = result.pages[0]?.operation.codeSamples[0]?.code ?? "";
    expect(curl).toContain(
      'curl -X POST "https://api.example.com/search?limit=8"'
    );
    expect(curl).toContain('-H "Content-Type: application/json"');
    expect(curl).toContain('"query": "string"');
  });

  it("accepts webhooks-only OpenAPI 3.1 documents", async () => {
    const spec = `
openapi: 3.1.0
info: { title: Hooks, version: 1.0.0 }
webhooks:
  ping:
    post:
      operationId: pingHook
      responses: { "200": { description: ok } }
`;
    const { result } = await generateFixturePages(spec);
    expect(result.pages).toHaveLength(0);
    expect(result.nav).toHaveLength(0);
  });

  it("rejects Swagger 2.0 documents with a conversion hint", async () => {
    const dir = await createTempDir();
    const docsDir = path.join(dir, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFixture(dir, "swagger.yaml", 'swagger: "2.0"\npaths: {}\n');
    const configs = normalizeOpenApiConfig({ input: "swagger.yaml" }, dir);
    await expect(writeOpenApiPages({ configs, docsDir })).rejects.toThrow(
      /Swagger 2\.0/
    );
  });
});

describe("stageOpenApiDocs", () => {
  it("stages a docs copy with generated pages and cleans up", async () => {
    const dir = await createTempDir();
    const docsDir = path.join(dir, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFile(
      path.join(docsDir, "intro.mdx"),
      "---\ntitle: Intro\n---\n"
    );
    await writeFixture(docsDir, "openapi.yaml", FIXTURE_SPEC);

    const staged = await stageOpenApiDocs({
      contentDir: docsDir,
      openapi: { input: "./openapi.yaml", output: "rest-api" },
    });
    expect(staged.contentDir).not.toBe(docsDir);
    expect(existsSync(path.join(staged.contentDir, "intro.mdx"))).toBe(true);
    expect(
      existsSync(
        path.join(
          staged.contentDir,
          "rest-api",
          "access-groups",
          "read-access-group.mdx"
        )
      )
    ).toBe(true);
    expect(staged.nav).toHaveLength(1);
    // The authored source is untouched.
    expect(existsSync(path.join(docsDir, "rest-api"))).toBe(false);

    await staged.cleanup();
    expect(existsSync(staged.contentDir)).toBe(false);
  });
});

describe("config validation", () => {
  it("throws when input is missing", () => {
    expect(() => normalizeOpenApiConfig({ input: "" }, process.cwd())).toThrow(
      /must set "input"/
    );
  });

  it("validates untyped docs config openapi blocks", () => {
    expect(validateDocsOpenApiConfig(undefined, "config")).toBeUndefined();
    expect(() =>
      validateDocsOpenApiConfig({ output: "api" }, "config")
    ).toThrow(/must set "input"/);
    expect(() =>
      validateDocsOpenApiConfig(
        { input: "a.yaml", slugStrategy: "nope" },
        "config"
      )
    ).toThrow(/slugStrategy/);
    expect(() =>
      validateDocsOpenApiConfig([{ input: "a.yaml", order: "1" }], "config")
    ).toThrow(/"order" must be a number/);
    expect(
      validateDocsOpenApiConfig({ input: "a.yaml" }, "config")
    ).toMatchObject({ input: "a.yaml" });
  });
});

describe("escapeMarkdownForMdx", () => {
  it("escapes JSX and expression openers in prose", () => {
    expect(escapeMarkdownForMdx("use {id} and <token>")).toBe(
      "use \\{id\\} and \\<token>"
    );
  });

  it("preserves inline code, fences, and autolinks", () => {
    expect(escapeMarkdownForMdx("keep `{id}` and <https://example.com>")).toBe(
      "keep `{id}` and <https://example.com>"
    );
    const fenced = "```ts\nconst a = {id: 1};\n```";
    expect(escapeMarkdownForMdx(fenced)).toBe(fenced);
  });
});

describe("buildSchemaExample", () => {
  it("synthesizes nested payloads from schema summaries", () => {
    expect(
      buildSchemaExample({
        properties: [
          { name: "query", type: "string" },
          { default: 8, name: "limit", type: "integer" },
          {
            items: {
              properties: [
                { format: "uuid", name: "id", type: "string" },
                { enum: ["a", "b"], name: "kind", type: '"a" | "b"' },
              ],
              type: "object",
            },
            name: "results",
            type: "object[]",
          },
        ],
        type: "object",
      })
    ).toEqual({
      limit: 8,
      query: "string",
      results: [{ id: "123e4567-e89b-12d3-a456-426614174000", kind: "a" }],
    });
  });
});
