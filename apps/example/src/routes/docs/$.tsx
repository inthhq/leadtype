/** biome-ignore-all lint/style/useFilenamingConvention: TanStack Router catch-all route convention */
"use client";

import { createFileRoute, notFound } from "@tanstack/react-router";
import { type ComponentType, lazy, Suspense, useMemo } from "react";
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
 * `import.meta.glob` enumerates every doc MDX at build time and returns
 * lazy loaders. Vite resolves the literal glob pattern statically, so the
 * keys are file paths relative to this file. Each `globKey` field in the
 * manifest matches one of these keys exactly.
 */
const mdxModules = import.meta.glob<{ default: ComponentType }>(
  "../../../../../docs/**/*.mdx"
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
      <code>bun run docs-source-manifest</code> after adding docs files.
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
  // beforeLoad throws notFound() for missing pages, so page is non-null here
  // by the time this component renders. Cast keeps the hook unconditional.
  const page = resolvePage(_splat) as DocsPage;

  const MdxComponent = useMemo(() => {
    const loader = mdxModules[page.globKey];
    if (!loader) {
      return () => <MissingMdxModule urlPath={page.urlPath} />;
    }
    return lazy(loader);
  }, [page.globKey, page.urlPath]);

  return (
    <Suspense fallback={null}>
      <MdxComponent />
    </Suspense>
  );
}
