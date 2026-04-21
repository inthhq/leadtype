import { expect, test } from "@playwright/test";

const REFERENCE_APP_HEADING = /Reference app for/i;

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
  await expect(page.locator("[data-inth-selector-content]")).toHaveAttribute(
    "data-value",
    "pipeline"
  );
  await expect(page.locator("[data-inth-selector-content]")).toContainText(
    "Pipeline test"
  );
  await expect(page.locator("[data-inth-selector-content]")).toContainText(
    "stable `basePath`"
  );
});
