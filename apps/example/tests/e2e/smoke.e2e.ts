import { expect, type Page, test } from "@playwright/test";

const AI_DISABLED_MESSAGE = /AI answers are disabled/i;
const REMARK_DOCS_URL = /\/docs\/reference\/remark/;

async function waitForClientHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.readyState === "complete" && !("$_TSR" in window)
  );
}

test("home renders the developer dashboard with package surfaces", async ({
  page,
  request,
}) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(html).toContain("Leadtype");
  expect(html).toContain("One MDX source");
  expect(html).toContain("application/ld+json");

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveURL("/");
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

test("/docs/reference/remark renders the remark plugin reference", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs/reference/remark");
  const html = await response.text();

  expect(html).toContain("Remark");
  expect(html).toContain("defaultRemarkPlugins");
  expect(html).toContain("PipelineExampleOptions");

  await page.goto("/docs/reference/remark", { waitUntil: "networkidle" });
  await waitForClientHydration(page);
  await expect(
    page.getByRole("heading", { name: "Remark plugins", exact: true })
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
  expect(docsSitemapXml.ok()).toBe(true);
  expect(await docsSitemapXml.text()).toContain(
    `<loc>${requestOrigin}/docs/quickstart</loc>`
  );

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
  expect(llmsText).not.toContain("https://docs.example.com/docs/quickstart");

  for (const urlPath of ["/docs/index.md", "/docs/quickstart.md"]) {
    const markdownMirror = await request.get(urlPath);
    expect(markdownMirror.ok()).toBe(true);
  }

  // /llms-full.txt is an agent artifact, not a markdown mirror — even when
  // an agent asks for markdown the static text file should be returned, not
  // a "Page not found" body.
  const llmsFullTxt = await request.get("/llms-full.txt", {
    headers: { Accept: "text/markdown" },
  });
  expect(llmsFullTxt.ok()).toBe(true);
  const llmsFullText = await llmsFullTxt.text();
  expect(llmsFullText).toContain("Full Context Router");
  expect(llmsFullText).not.toContain("# Page not found");
});

test("docs pages expose canonical and markdown mirror metadata", async ({
  request,
}) => {
  const htmlResponse = await request.get("/docs/quickstart");
  expect(htmlResponse.ok()).toBe(true);
  const html = await htmlResponse.text();
  expect(html).toContain('rel="canonical"');
  expect(html).toContain("https://docs.example.com/docs/quickstart");
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
    '<https://docs.example.com/docs/quickstart>; rel="canonical"'
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
