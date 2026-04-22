import { expect, type Page, test } from "@playwright/test";

const DASHBOARD_HEADING = /Build docs with @inth\/docs/i;
const QUICKSTART_ROUTE_LINK = /Quickstart/;
const AI_DISABLED_MESSAGE = /AI answers are disabled/i;
const QUICKSTART_INSTALL_HEADING_HREF = "/docs/guides/quickstart#1-install";
const COMPONENT_FIXTURE_CALLOUT_COUNT = 3;

async function waitForClientHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.readyState === "complete" && !("$_TSR" in window)
  );
}

test("home route renders the developer dashboard and package surfaces", async ({
  page,
  request,
}) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(html).toContain("Build docs with");
  expect(html).toContain("Implementation contract");
  expect(html).toContain("@inth/docs/search/bash");

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByText(DASHBOARD_HEADING)).toBeVisible();
  await expect(
    page.getByRole("link", { name: QUICKSTART_ROUTE_LINK }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Package surfaces", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Smoke coverage", exact: true })
  ).toBeVisible();
});

test("docs route renders package docs and extracted ExtractedTypeTable output", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs");
  const html = await response.text();

  expect(html).toContain("@inth/docs");
  expect(html).toContain("@inth/docs/search/bash");
  expect(html).toContain("PipelineExampleOptions");

  await page.goto("/docs", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "@inth/docs", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ExtractedTypeTable", exact: true })
  ).toBeVisible();
  const extractedTypeTable = page.locator("[data-inth-extracted-type-table]");
  await expect(extractedTypeTable).toContainText("PipelineExampleOptions");
  await expect(extractedTypeTable).toContainText("value");
  await expect(extractedTypeTable).toContainText("label");
  await expect(extractedTypeTable).toContainText("featured");
});

test("search docs route explains the headless search APIs", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs/search");
  const html = await response.text();

  expect(html).toContain("Search APIs");
  expect(html).toContain("@inth/docs/search");

  await page.goto("/docs/search", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "Search APIs", exact: true })
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
  expect(html).toContain("What You Are Wiring");
  expect(html).toContain("scripts/docs-convert.ts");
  expect(html).toContain("Package manager");

  await page.goto("/docs/guides/quickstart", { waitUntil: "networkidle" });
  await waitForClientHydration(page);
  await expect(
    page.getByRole("heading", { name: "Quickstart", exact: true })
  ).toBeVisible();

  const packageManager = page.getByRole("button", { name: "pnpm" });
  await packageManager.click();
  await expect(page.locator("[data-inth-command-tabs-output]")).toContainText(
    "pnpm add @inth/docs"
  );
  await expect(
    page
      .locator("code")
      .filter({ hasText: "public/docs/search-index.json" })
      .first()
  ).toBeVisible();
  await expect(
    page.locator("code").filter({ hasText: "docs:build" }).first()
  ).toBeVisible();
});

test("components fixture renders package adapters and preserves external link safety", async ({
  page,
  request,
}) => {
  const response = await request.get("/docs/guides/components-fixture");
  const html = await response.text();

  expect(html).toContain("Runtime Components");
  expect(html).toContain("Runtime fixture");

  await page.goto("/docs/guides/components-fixture", {
    waitUntil: "networkidle",
  });
  await waitForClientHydration(page);
  await expect(
    page.getByRole("heading", { name: "Runtime Components", exact: true })
  ).toBeVisible();
  await expect(page.locator("[data-inth-callout]")).toHaveCount(
    COMPONENT_FIXTURE_CALLOUT_COUNT
  );
  await expect(page.locator("[data-inth-accordion]")).toBeVisible();
  await expect(page.locator("[data-inth-cards]")).toBeVisible();
  await expect(page.locator("[data-inth-example]")).toBeVisible();
  await expect(page.locator("[data-inth-steps]")).toBeVisible();
  await expect(page.locator("[data-inth-topic-switcher]")).toBeVisible();

  const overview = page.getByRole("tab", { name: "Overview" });
  const tables = page.getByRole("tab", { name: "Tables" });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(tables).toHaveAttribute("aria-selected", "true");
  await expect(tables).toBeFocused();

  const externalCard = page.locator('a[href="https://example.com/docs"]');
  await expect(externalCard).toHaveAttribute("target", "_blank");
  await expect(externalCard).toHaveAttribute("rel", "noopener");
});

test("playground route updates selector content", async ({ page }) => {
  await page.goto("/playground", { waitUntil: "networkidle" });
  await waitForClientHydration(page);
  await expect(page.getByText("Recipes playground")).toBeVisible();

  await page.selectOption("[data-inth-selector-control]", "convert");
  const selectorContent = page.locator("[data-inth-selector-content]");
  await expect(selectorContent).toHaveAttribute("data-value", "convert");
  await expect(selectorContent).toContainText("Convert For Agents");
  await expect(selectorContent).toContainText("defaultRemarkPlugins");

  await page.selectOption("[data-inth-selector-control]", "search");
  await expect(selectorContent).toHaveAttribute("data-value", "search");
  await expect(selectorContent).toContainText("streamDocsAnswer");
  await expect(
    selectorContent.getByRole("link", { name: "Open live search" })
  ).toBeVisible();
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
  await waitForClientHydration(page);
  await expect(
    page.getByRole("heading", { name: "Search the docs", exact: true })
  ).toBeVisible();

  const installSearchResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/docs/search?q=install") && response.ok()
  );
  await page.getByLabel("Search query").fill("install");
  await installSearchResponse;
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  const quickstartLink = page.locator(
    `section[aria-live="polite"] a[href="${QUICKSTART_INSTALL_HEADING_HREF}"]`
  );
  await expect(quickstartLink).toBeVisible();
  await expect(quickstartLink).toContainText("Quickstart");

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
