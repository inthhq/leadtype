import { expect, test } from "@playwright/test";

// Smoke gate for the Next.js member of the docs matrix: it renders the REAL
// leadtype docs at apps/tanstack fidelity (reused MDX components + styling).

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

test("docs index renders the sidebar nav", async ({ request }) => {
  const html = await (await request.get("/docs")).text();
  expect(html).toContain('class="docs-sidebar"');
  expect(html).toContain("Quickstart");
});

test("a docs page renders rich MDX components", async ({ request }) => {
  const response = await request.get("/docs/quickstart");
  expect(response.status()).toBe(200);
  const html = await response.text();
  // apps/tanstack components render with data-leadtype-* hooks.
  expect(html).toContain("data-leadtype-callout");
});

test("agent surface: llms.txt and markdown mirror are served", async ({
  request,
}) => {
  expect((await request.get("/llms.txt")).status()).toBe(200);
  const mirror = await request.get("/docs/quickstart.md");
  expect(mirror.status()).toBe(200);
  expect(await mirror.text()).toContain("Quickstart");

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
    const hits = (await search?.execute({ query: "quickstart" }, {})) as Array<{
      urlPath: string;
    }>;
    const markdown = (await getPage?.execute(
      { urlPath: hits[0]?.urlPath ?? "" },
      {}
    )) as string;
    return { hits: hits.length, markdown };
  });

  expect(result.hits).toBeGreaterThan(0);
  expect(result.markdown).toContain("Quickstart");
});
