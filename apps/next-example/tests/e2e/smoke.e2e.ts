import { expect, test } from "@playwright/test";

// Smoke gate for the Next.js member of the docs matrix: it renders the REAL
// leadtype docs at apps/tanstack fidelity (reused MDX components + styling).

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
