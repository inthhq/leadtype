import { expect, test } from "@playwright/test";

const REFERENCE_APP_HEADING = /Reference app for/i;
const QUICKSTART_LINK = /Quickstart/i;
const AI_DISABLED_MESSAGE = /AI answers are disabled/i;
const QUICKSTART_HEADING_HREF = /\/docs\/guides\/quickstart#quickstart$/;

test("home route renders the consumer QA overview and route links", async ({
  page,
  request,
}) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(html).toContain("Reference app for");
  expect(html).toContain("Consumer contract");

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByText(REFERENCE_APP_HEADING)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Overview" }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Coverage", exact: true })
  ).toBeVisible();
});

test("docs route renders package docs and extracted AutoTypeTable output", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs");
  const html = await response.text();

  expect(html).toContain("@inth/docs");
  expect(html).toContain("PipelineExampleOptions");

  await page.goto("/docs", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "@inth/docs", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "AutoTypeTable", exact: true })
  ).toBeVisible();
  const autoTypeTable = page.locator("[data-inth-auto-type-table]");
  await expect(autoTypeTable).toContainText("PipelineExampleOptions");
  await expect(autoTypeTable).toContainText("value");
  await expect(autoTypeTable).toContainText("label");
  await expect(autoTypeTable).toContainText("featured");
});

test("search docs route explains the headless search APIs", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs/search");
  const html = await response.text();

  expect(html).toContain("Search and AI Answers");
  expect(html).toContain("@inth/docs/search");

  await page.goto("/docs/search", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Search and AI Answers", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "/search", exact: true })
  ).toBeVisible();
});

test("quickstart route renders MDX content on the server and hydrates interactive adapters", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs/guides/quickstart");
  const html = await response.text();

  expect(html).toContain("Quickstart");
  expect(html).toContain("Install the package.");
  expect(html).toContain("Package manager");

  await page.goto("/docs/guides/quickstart", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Quickstart", exact: true })
  ).toBeVisible();

  const packageManager = page.getByRole("button", { name: "pnpm" });
  await packageManager.click();
  await expect(
    page.locator("[data-inth-package-command-tabs-output]")
  ).toContainText("pnpm install @inth/docs");

  const overview = page.getByRole("tab", { name: "Overview" });
  const advanced = page.getByRole("tab", { name: "Advanced" });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(advanced).toHaveAttribute("aria-selected", "true");
  await expect(advanced).toBeFocused();
});

test("components fixture renders package adapters and preserves external link safety", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs/guides/components-fixture");
  const html = await response.text();

  expect(html).toContain("Components Fixture");
  expect(html).toContain("Runtime fixture");

  await page.goto("/docs/guides/components-fixture", {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("heading", { name: "Components Fixture", exact: true })
  ).toBeVisible();
  await expect(page.locator("[data-inth-callout]")).toHaveCount(2);
  await expect(page.locator("[data-inth-cards]")).toBeVisible();
  await expect(page.locator("[data-inth-steps]")).toBeVisible();

  const externalCard = page.locator('a[href="https://example.com/docs"]');
  await expect(externalCard).toHaveAttribute("target", "_blank");
  await expect(externalCard).toHaveAttribute("rel", "noopener");
});

test("playground route updates selector content", async ({ page }) => {
  await page.goto("/playground", { waitUntil: "networkidle" });
  await expect(page.getByText("Selector playground")).toBeVisible();

  await page.selectOption("[data-inth-selector-control]", "pipeline");
  const selectorContent = page.locator("[data-inth-selector-content]");
  await expect(selectorContent).toHaveAttribute("data-value", "pipeline");
  await expect(selectorContent).toContainText("Pipeline test");
  await expect(selectorContent).toContainText("stable `basePath`");
});

test("search route returns local docs results and answer configuration state", async ({
  page,
  request,
}) => {
  const answerConfigResponse = await request.get("/api/docs/ask");
  const answerConfig = (await answerConfigResponse.json()) as {
    enabled: boolean;
  };

  await page.goto("/search", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Search the docs", exact: true })
  ).toBeVisible();

  await page.getByLabel("Search query").fill("install");
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  const quickstartLink = page
    .locator('section[aria-live="polite"]')
    .getByRole("link", { name: QUICKSTART_LINK })
    .first();
  await expect(quickstartLink).toBeVisible();
  await expect(quickstartLink).toHaveAttribute("href", QUICKSTART_HEADING_HREF);

  if (!answerConfig.enabled) {
    await expect(page.getByText(AI_DISABLED_MESSAGE)).toBeVisible();
  }
});

test("search api returns JSON results", async ({ request }) => {
  const response = await request.get("/api/docs/search?q=install");

  expect(response.ok()).toBe(true);
  const data = (await response.json()) as {
    results: Array<{ title: string; urlPath: string }>;
  };
  expect(data.results.length).toBeGreaterThan(0);
  expect(data.results.some((result) => result.title === "Quickstart")).toBe(
    true
  );
});
