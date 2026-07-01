import { expect, type Page, test } from "@playwright/test";

const AI_DISABLED_MESSAGE = /AI answers are disabled/i;
const DOCS_URL = /\/docs$/;
const REMARK_DOCS_URL = /\/docs\/reference\/remark/;
const DIGIT_LEADING_HASH_URL = /#1-generate-the-artifacts$/;

async function waitForClientHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.readyState === "complete" && !("$_TSR" in window)
  );
}

async function installWebMcpMock(page: Page): Promise<void> {
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

test("home redirects to docs", async ({ page, request }) => {
  const response = await request.get("/");

  expect(response.url()).toMatch(DOCS_URL);

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveURL("/docs");
  await expect(
    page.getByRole("heading", { name: "Leadtype", exact: true })
  ).toBeVisible();
});

test("/docs renders the package overview MDX", async ({ page, request }) => {
  const response = await request.get("/docs");
  const html = await response.text();

  expect(html).toContain("leadtype");

  await page.goto("/docs", { waitUntil: "networkidle" });
  // Sidebar populated from docs.config.ts sections.
  const overviewNav = page.getByRole("navigation", {
    name: "Get Started documentation",
  });
  await expect(
    overviewNav.getByRole("link", { name: "Leadtype" })
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", {
        name: "Authoring documentation",
      })
      .getByRole("link", { name: "Components" })
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Reference documentation" })
      .getByRole("link", { name: "Convert" })
  ).toBeVisible();
});

test("/docs/reference/markdown renders the markdown transform reference", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs/reference/markdown");
  const html = await response.text();

  expect(html).toContain("Markdown transforms");
  expect(html).toContain("defaultMarkdownTransforms");
  expect(html).toContain("PipelineExampleOptions");

  await page.goto("/docs/reference/markdown", { waitUntil: "networkidle" });
  await waitForClientHydration(page);
  await expect(
    page.getByRole("heading", { name: "Markdown transforms", exact: true })
  ).toBeVisible();
});

test("/docs/reference/search renders the search APIs reference", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs/reference/search");
  const html = await response.text();

  expect(html).toContain("leadtype/search");

  await page.goto("/docs/reference/search", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("link", { name: "Search", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Search", exact: true })
  ).toBeVisible();
  const toc = page.getByRole("navigation", { name: "On this page" });
  await expect(toc.getByRole("link", { name: "Runtime search" })).toBeVisible();
  const runtimeSearch = toc.getByRole("link", { name: "Runtime search" });
  await expect(runtimeSearch).toHaveAttribute(
    "href",
    "/docs/reference/search#runtime-search"
  );
  await expect(page.locator("#runtime-search")).toBeAttached();
});

test("heading anchors handle inline markup and digit-leading slugs", async ({
  page,
}) => {
  // Inline-markup heading: `### `meta.json`` must render with id="meta-json"
  // so the TOC anchor link resolves. Pre-fix, textFromChildren returned ""
  // for ReactElement children, so the heading had no id.
  await page.goto("/docs/reference/lint", { waitUntil: "networkidle" });
  await waitForClientHydration(page);
  await expect(page.locator('[id="meta-json"]')).toBeAttached();
  const lintToc = page.getByRole("navigation", { name: "On this page" });
  await expect(
    lintToc.getByRole("link", { name: "meta.json" })
  ).toHaveAttribute("href", "/docs/reference/lint#meta-json");

  // Digit-leading heading slug (`## 1. Generate the artifacts`): clicking the
  // in-content heading anchor previously called querySelector("#1-...") which
  // throws SyntaxError because CSS idents can't start with a digit, so the
  // scrollIntoView never fired. Now uses getElementById.
  await page.goto("/docs/aeo/optimize-docs-for-agents", {
    waitUntil: "networkidle",
  });
  await waitForClientHydration(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const heading = page.locator('[id="1-generate-the-artifacts"]');
  await expect(heading).toBeAttached();
  await heading.locator("a[data-docs-heading-anchor]").click();
  await expect(page).toHaveURL(DIGIT_LEADING_HASH_URL);
  // If the click handler crashed before scrollIntoView, the heading would
  // still be below the fold. Post-fix it is scrolled into view.
  const top = await heading.evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThan(200);
});

test("/search returns local docs results and answer configuration", async ({
  page,
  request,
}) => {
  const answerConfigResponse = await request.get("/api/docs/ask");
  const answerConfig = (await answerConfigResponse.json()) as {
    enabled: boolean;
  };

  await page.goto("/search", { waitUntil: "networkidle" });
  await waitForClientHydration(page);
  await expect(
    page.getByRole("heading", { name: "Search the docs", exact: true })
  ).toBeVisible();

  const searchResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/search?q=convert") && response.ok()
  );
  await page.getByLabel("Search query").fill("convert");
  await searchResponse;
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();

  if (!answerConfig.enabled) {
    await expect(page.getByText(AI_DISABLED_MESSAGE)).toBeVisible();
  }
});

test("/api/docs/search returns JSON results for a known term", async ({
  request,
}) => {
  const response = await request.get("/api/docs/search?q=convert");

  expect(response.ok()).toBe(true);
  const data = (await response.json()) as {
    results: Array<{ title: string; urlPath: string }>;
  };
  expect(data.results.length).toBeGreaterThan(0);
});

test("agent readability discovery files are served at the site root", async ({
  request,
}) => {
  const quickstartResponse = await request.get("/docs/quickstart");
  const requestOrigin = new URL(quickstartResponse.url()).origin;

  const sitemapXml = await request.get("/sitemap.xml");
  expect(sitemapXml.ok()).toBe(true);
  const xml = await sitemapXml.text();
  expect(xml).toContain("<urlset");
  expect(xml).toContain(`<loc>${requestOrigin}/docs/quickstart</loc>`);
  expect(xml).toContain("<lastmod>");

  const docsSitemapXml = await request.get("/docs/sitemap.xml");
  expect(docsSitemapXml.ok()).toBe(false);

  const sitemapMd = await request.get("/sitemap.md");
  expect(sitemapMd.ok()).toBe(true);
  const markdown = await sitemapMd.text();
  expect(markdown).toContain("# Sitemap");
  expect(markdown).toContain("[Quickstart](/docs/quickstart)");

  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  const robotsText = await robots.text();
  expect(robotsText).toContain("User-agent: GPTBot");
  expect(robotsText).toContain("Allow: /llms.txt");
  expect(robotsText).toContain(`Sitemap: ${requestOrigin}/sitemap.xml`);

  const llmsTxt = await request.get("/llms.txt");
  expect(llmsTxt.ok()).toBe(true);
  const llmsText = await llmsTxt.text();
  expect(llmsText).toContain("](/docs/index.md)");
  expect(llmsText).toContain("](/docs/quickstart.md)");
  expect(llmsText).not.toContain("https://leadtype.dev/docs/quickstart");

  for (const urlPath of ["/docs/index.md", "/docs/quickstart.md"]) {
    const markdownMirror = await request.get(urlPath);
    expect(markdownMirror.ok()).toBe(true);
  }

  const changelogRss = await request.get("/changelog/rss.xml");
  expect(changelogRss.ok()).toBe(true);
  expect(await changelogRss.text()).toContain(
    "<title>Leadtype Changelog</title>"
  );

  const changelogAtom = await request.get("/changelog/atom.xml");
  expect(changelogAtom.ok()).toBe(true);
  expect(await changelogAtom.text()).toContain("<title>Leadtype 0.2</title>");

  // /llms-full.txt is an agent artifact, not a markdown mirror — even when
  // an agent asks for markdown the static text file should be returned, not
  // a "Page not found" body.
  const llmsFullTxt = await request.get("/llms-full.txt", {
    headers: { Accept: "text/markdown" },
  });
  expect(llmsFullTxt.ok()).toBe(true);
  const llmsFullText = await llmsFullTxt.text();
  expect(llmsFullText).toContain("Full Context");
  expect(llmsFullText).toContain("Quickstart");
  expect(llmsFullText).not.toContain("# Page not found");
});

test("docs pages expose canonical and markdown mirror metadata", async ({
  request,
}) => {
  const htmlResponse = await request.get("/docs/quickstart");
  expect(htmlResponse.ok()).toBe(true);
  const html = await htmlResponse.text();
  expect(html).toContain('rel="canonical"');
  expect(html).toContain("https://leadtype.dev/docs/quickstart");
  expect(html).toContain('rel="alternate"');
  expect(html).toContain('type="text/markdown"');
  expect(html).toContain('property="og:title"');
  expect(html).toContain("application/ld+json");
  expect(html).toContain("TechArticle");

  const markdownResponse = await request.get("/docs/quickstart", {
    headers: { Accept: "text/markdown" },
  });
  expect(markdownResponse.ok()).toBe(true);
  expect(markdownResponse.headers().vary).toContain("Accept");
  expect(markdownResponse.headers().link).toContain(
    '<https://leadtype.dev/docs/quickstart>; rel="canonical"'
  );
  expect(markdownResponse.headers()["cache-control"]).toContain("max-age=300");
  const markdown = await markdownResponse.text();
  expect(markdown).toContain("# Quickstart");
  expect(markdown).toContain("canonical_url:");
  expect(markdown).toContain("last_updated:");

  const agentResponse = await request.get("/docs/quickstart", {
    headers: { "User-Agent": "ClaudeBot/1.0" },
  });
  expect(agentResponse.ok()).toBe(true);
  expect(agentResponse.headers()["content-type"]).toContain("text/markdown");
  const agentMarkdown = await agentResponse.text();
  expect(agentMarkdown).toContain("# Quickstart");
  expect(agentMarkdown).not.toContain("<!DOCTYPE html>");

  const docsIndexMarkdown = await request.get("/docs.md");
  expect(docsIndexMarkdown.ok()).toBe(true);
  expect(docsIndexMarkdown.headers()["content-type"]).toContain(
    "text/markdown"
  );
  expect(await docsIndexMarkdown.text()).toContain("# Leadtype");

  const missingMarkdown = await request.get(
    "/this-page-does-not-exist-404-test",
    {
      headers: {
        Accept: "text/markdown",
        "User-Agent": "ClaudeBot/1.0",
      },
    }
  );
  expect(missingMarkdown.ok()).toBe(true);
  expect(missingMarkdown.headers()["content-type"]).toContain("text/markdown");
  expect(await missingMarkdown.text()).toContain("# Page not found");
});

test("keyboard shortcut search popover opens, queries, and navigates", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await waitForClientHydration(page);

  // Open via keyboard shortcut.
  const shortcut = process.platform === "darwin" ? "Meta+k" : "Control+k";
  await page.keyboard.press(shortcut);
  const popover = page.getByRole("dialog", { name: "Search docs" });
  await expect(popover).toBeVisible();

  // Type a query that maps to a known doc.
  const searchResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/search?q=remark") && response.ok()
  );
  await popover.getByLabel("Search query").fill("remark");
  await searchResponse;

  // Click the first result and verify navigation.
  const firstResult = popover.locator("ul li a").first();
  await expect(firstResult).toBeVisible();
  await firstResult.click();
  await expect(page).toHaveURL(REMARK_DOCS_URL);
});

test("playground route renders the recipes panel", async ({ page }) => {
  await page.goto("/playground", { waitUntil: "networkidle" });
  await waitForClientHydration(page);
  await expect(page.getByText("Recipes playground")).toBeVisible();
});

test("registers docs tools with WebMCP on page load", async ({ page }) => {
  await installWebMcpMock(page);
  await page.goto("/docs", { waitUntil: "networkidle" });
  await waitForClientHydration(page);

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
