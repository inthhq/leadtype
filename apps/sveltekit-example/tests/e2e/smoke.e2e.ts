import { expect, test } from "@playwright/test";

// Smoke gate for the SvelteKit member of the docs matrix.

async function installWebMcpMock(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const tools: Array<{
      execute: (input: Record<string, unknown>, client: object) => unknown;
      name: string;
    }> = [];
    Object.defineProperty(window, "__leadtypeWebMcpTools", {
      configurable: true,
      value: tools,
    });
    Object.defineProperty(window.navigator, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: (typeof tools)[number]) {
          tools.push(tool);
        },
      },
    });
  });
}

test("docs index renders nav + Leadtype content", async ({ request }) => {
  const response = await request.get("/docs");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('class="docs-sidebar"');
  expect(html).toContain("Leadtype is a");
  expect(html).toContain("one MDX source");
});

test("docs sub-page renders the root docs corpus", async ({ request }) => {
  const response = await request.get("/docs/authoring/components");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("MDX components");
  expect(html).toContain("/docs/authoring/frontmatter");
});

test("agent surface: llms.txt and markdown mirror are served", async ({
  request,
}) => {
  expect((await request.get("/llms.txt")).status()).toBe(200);
  const mirror = await request.get("/docs/authoring/components.md");
  expect(mirror.status()).toBe(200);
  expect(await mirror.text()).toContain("MDX components");

  const rss = await request.get("/changelog/rss.xml");
  expect(rss.status()).toBe(200);
  expect(await rss.text()).toContain("<title>Leadtype Changelog</title>");

  const atom = await request.get("/changelog/atom.xml");
  expect(atom.status()).toBe(200);
  expect(await atom.text()).toContain("<title>Leadtype 0.2</title>");
});

test("registers docs tools with WebMCP on page load", async ({ page }) => {
  await installWebMcpMock(page);
  await page.goto("/docs", { waitUntil: "networkidle" });

  await page.waitForFunction(() => {
    const tools = (
      window as unknown as {
        __leadtypeWebMcpTools?: Array<{ name: string }>;
      }
    ).__leadtypeWebMcpTools;
    return tools?.some((tool) => tool.name === "search-docs");
  });

  const result = await page.evaluate(async () => {
    const tools = (
      window as unknown as {
        __leadtypeWebMcpTools: Array<{
          execute: (
            input: Record<string, unknown>,
            client: object
          ) => Promise<unknown> | unknown;
          name: string;
        }>;
      }
    ).__leadtypeWebMcpTools;
    const search = tools.find((tool) => tool.name === "search-docs");
    const getPage = tools.find((tool) => tool.name === "get-page");
    // execute()'s second argument is the WebMCP client (ModelContextClient);
    // the docs tools never touch it, so an empty stub suffices here.
    const hits = (await search?.execute({ query: "components" }, {})) as Array<{
      urlPath: string;
    }>;
    const markdown = (await getPage?.execute(
      { urlPath: hits[0]?.urlPath ?? "" },
      {}
    )) as string;
    return { hits: hits.length, markdown };
  });

  expect(result.hits).toBeGreaterThan(0);
  expect(result.markdown).toContain("Components");
});
