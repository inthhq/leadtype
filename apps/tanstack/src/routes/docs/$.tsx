/** biome-ignore-all lint/style/useFilenamingConvention: TanStack Router catch-all route convention */

import { createFileRoute, notFound } from "@tanstack/react-router";
import type { ComponentType } from "react";
import docsPages from "@/generated/docs-pages.json";
import { createDocsHead } from "@/lib/docs-head";

interface DocsPage {
  description: string;
  extension: ".md" | ".mdx";
  /** Relative to this file — matches an `import.meta.glob` key exactly. */
  globKey: string;
  groups: string[];
  relativePath: string;
  slug: string[];
  title: string;
  urlPath: string;
}

const pages = docsPages as DocsPage[];
const pagesByJoinedSlug = new Map(
  pages.map((page) => [page.slug.join("/"), page])
);

const TRAILING_SLASH_RE = /\/+$/;

/**
 * `import.meta.glob` with `eager: true` compiles every doc MDX into this route's
 * bundle at build time, so changing pages swaps components synchronously — no
 * per-page dynamic import and no Suspense fallback flash on navigation. Vite
 * resolves the literal glob pattern statically, so the keys are file paths
 * relative to this file; each `globKey` field in the manifest matches one
 * exactly. (Trade-off: all docs ship in the `/docs` chunk — ideal for a docs
 * site you browse page-to-page; revisit lazy loading only for a huge corpus.)
 */
const mdxModules = import.meta.glob<{ default: ComponentType }>(
  "../../../../../docs/**/*.mdx",
  { eager: true }
);

function resolvePage(splat: string | undefined): DocsPage | null {
  if (!splat) {
    return null;
  }
  const normalized = splat.replace(TRAILING_SLASH_RE, "");
  return pagesByJoinedSlug.get(normalized) ?? null;
}

function MissingMdxModule({ urlPath }: { urlPath: string }) {
  return (
    <div data-leadtype-mdx-error>
      MDX module not found for <code>{urlPath}</code>. Re-run{" "}
      <code>bun run pipeline:source-manifest</code> after adding docs files.
    </div>
  );
}

export const Route = createFileRoute("/docs/$")({
  beforeLoad: ({ params }) => {
    if (!resolvePage(params._splat)) {
      throw notFound();
    }
  },
  component: DocsCatchAllRoute,
  head: ({ params }) => {
    const page = resolvePage(params._splat);
    return page ? createDocsHead(page.urlPath) : {};
  },
});

function DocsCatchAllRoute() {
  const { _splat } = Route.useParams();
  // beforeLoad throws notFound() for missing pages, so this should always
  // resolve by the time the component renders. The explicit check both
  // narrows the type and surfaces a clear error if the invariant ever breaks.
  const pageCandidate = resolvePage(_splat);
  if (!pageCandidate) {
    throw new Error(
      `DocsCatchAllRoute rendered with no resolvable page for splat "${_splat}". beforeLoad should have thrown notFound() — file a bug if you see this.`
    );
  }
  const page: DocsPage = pageCandidate;

  // Eager modules are already evaluated, so this is a synchronous lookup —
  // the component renders immediately, with no loading frame between pages.
  const MdxComponent = mdxModules[page.globKey]?.default;
  if (!MdxComponent) {
    return <MissingMdxModule urlPath={page.urlPath} />;
  }

  return <MdxComponent />;
}
