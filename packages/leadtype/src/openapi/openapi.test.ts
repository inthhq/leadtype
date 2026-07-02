import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeOpenApiConfig, writeOpenApiPages } from "./index";

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

describe("OpenAPI page generation", () => {
  it("writes native MDX API reference pages and generated nav", async () => {
    const dir = await createTempDir();
    const docsDir = path.join(dir, "docs");
    await mkdir(docsDir, { recursive: true });
    await writeFile(
      path.join(dir, "openapi.yaml"),
      `
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
`
    );

    const configs = normalizeOpenApiConfig(
      {
        group: "api",
        input: "openapi.yaml",
        output: "rest-api",
      },
      dir
    );
    const result = await writeOpenApiPages({ configs, docsDir });

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
  });
});
