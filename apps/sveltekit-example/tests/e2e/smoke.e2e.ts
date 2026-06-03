import { expect, test } from "@playwright/test";

// Smoke gate for the SvelteKit member of the docs matrix.

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
});
