import { expect, type Page, test } from "@playwright/test";

const DASHBOARD_HEADING = /Build docs with @inth\/docs/i;
const AI_DISABLED_MESSAGE = /AI answers are disabled/i;
const REMARK_DOCS_URL = /\/docs\/remark/;

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

  expect(html).toContain("Build docs with");
  expect(html).toContain("@inth/docs/search/vercel");

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByText(DASHBOARD_HEADING)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Package surfaces", exact: true })
  ).toBeVisible();
});

test("/docs renders the package overview MDX", async ({ page, request }) => {
  const response = await request.get("/docs");
  const html = await response.text();

  expect(html).toContain("@inth/docs");

  await page.goto("/docs", { waitUntil: "networkidle" });
  // Sidebar populated from docs.config.ts sections.
  await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Components" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Convert" })).toBeVisible();
});

test("/docs/remark renders the remark plugin reference", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs/remark");
  const html = await response.text();

  expect(html).toContain("Remark");
  expect(html).toContain("defaultRemarkPlugins");
  expect(html).toContain("PipelineExampleOptions");

  await page.goto("/docs/remark", { waitUntil: "networkidle" });
  await waitForClientHydration(page);
  await expect(
    page.getByRole("heading", { name: "Remark", exact: true })
  ).toBeVisible();
});

test("/docs/search renders the search APIs reference", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs/search");
  const html = await response.text();

  expect(html).toContain("@inth/docs/search");

  await page.goto("/docs/search", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("link", { name: "Search", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("table").filter({ hasText: "@inth/docs/search/vercel" })
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

test("Cmd+K search popover opens, queries, and navigates", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await waitForClientHydration(page);

  // Open via keyboard shortcut.
  await page.keyboard.press("Meta+k");
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
