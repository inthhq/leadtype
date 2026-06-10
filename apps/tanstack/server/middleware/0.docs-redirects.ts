import { defineEventHandler, getRequestURL, sendRedirect } from "nitro/h3";

// Permanent redirects from the pre-capability-IA docs URLs (sections `build`,
// `authoring`, `sources`) to their new homes. Named `0.` so it runs before the
// agent-readability middleware, which would otherwise answer old `.md` mirror
// paths with a missing-page response instead of redirecting.
const MOVED_DOCS_PATHS = new Map<string, string>([
  ["/docs/build/build-a-docs-site", "/docs/pipeline/build-a-docs-site"],
  [
    "/docs/build/use-the-source-primitive",
    "/docs/pipeline/use-the-source-primitive",
  ],
  [
    "/docs/build/generate-static-artifacts",
    "/docs/pipeline/generate-static-artifacts",
  ],
  [
    "/docs/build/deploy-generated-artifacts",
    "/docs/pipeline/deploy-generated-artifacts",
  ],
  ["/docs/build/validate-in-ci", "/docs/pipeline/validate-in-ci"],
  ["/docs/build/localize-docs", "/docs/pipeline/localize-docs"],
  [
    "/docs/build/generate-rss-atom-feeds",
    "/docs/pipeline/generate-rss-atom-feeds",
  ],
  [
    "/docs/build/sync-docs-across-repos",
    "/docs/pipeline/sync-docs-across-repos",
  ],
  ["/docs/build/agent-setup-prompts", "/docs/pipeline/agent-setup-prompts"],
  [
    "/docs/build/optimize-docs-for-agents",
    "/docs/aeo/optimize-docs-for-agents",
  ],
  [
    "/docs/build/generate-artifacts-without-docs",
    "/docs/aeo/generate-artifacts-without-docs",
  ],
  ["/docs/build/serve-agent-responses", "/docs/aeo/serve-agent-responses"],
  ["/docs/build/framework-matrix", "/docs/integrations/framework-matrix"],
  [
    "/docs/build/integrate-with-fumadocs",
    "/docs/integrations/integrate-with-fumadocs",
  ],
  ["/docs/sources/configure-sources", "/docs/pipeline/configure-sources"],
  ["/docs/sources/collections", "/docs/pipeline/collections"],
  ["/docs/authoring/write-for-agents", "/docs/writing/write-for-agents"],
  ["/docs/authoring/frontmatter", "/docs/writing/frontmatter"],
  ["/docs/authoring/components", "/docs/writing/components"],
]);

const MARKDOWN_SUFFIX = ".md";

export default defineEventHandler((event) => {
  const { pathname } = getRequestURL(event);
  const isMarkdownMirror = pathname.endsWith(MARKDOWN_SUFFIX);
  const lookupPath = isMarkdownMirror
    ? pathname.slice(0, -MARKDOWN_SUFFIX.length)
    : pathname;
  const target = MOVED_DOCS_PATHS.get(lookupPath);
  if (!target) {
    return;
  }
  return sendRedirect(
    event,
    isMarkdownMirror ? `${target}${MARKDOWN_SUFFIX}` : target,
    301
  );
});
