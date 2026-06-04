/** biome-ignore-all lint/style/useFilenamingConvention: TanStack Router catch-all route convention */

import { createFileRoute, notFound } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { DocsShell } from "@/components/docs-shell";
import docsPages from "@/generated/docs-pages.json";
import { createDocsHead } from "@/lib/docs-head";

interface DocsPage {
  /** Relative to this file — matches an `import.meta.glob` key exactly. */
  globKey: string;
  title: string;
  urlPath: string;
}

const pages = docsPages as DocsPage[];
const pagesByUrlPath = new Map(pages.map((page) => [page.urlPath, page]));
const TRAILING_SLASH_RE = /\/+$/;

const mdxModules = import.meta.glob<{ default: ComponentType }>(
  "../../../../../docs/**/*.mdx",
  { eager: true }
);

function resolvePage(splat: string | undefined): DocsPage | null {
  if (!splat) {
    return null;
  }
  const normalized = splat.replace(TRAILING_SLASH_RE, "");
  return pagesByUrlPath.get(`/changelog/${normalized}`) ?? null;
}

function MissingMdxModule({ urlPath }: { urlPath: string }) {
  return (
    <div data-leadtype-mdx-error>
      MDX module not found for <code>{urlPath}</code>. Re-run{" "}
      <code>bun run pipeline:source-manifest</code> after adding docs files.
    </div>
  );
}

export const Route = createFileRoute("/changelog/$")({
  beforeLoad: ({ params }) => {
    if (!resolvePage(params._splat)) {
      throw notFound();
    }
  },
  component: ChangelogCatchAllRoute,
  head: ({ params }) => {
    const page = resolvePage(params._splat);
    return page ? createDocsHead(page.urlPath) : {};
  },
});

function ChangelogCatchAllRoute() {
  const { _splat } = Route.useParams();
  const pageCandidate = resolvePage(_splat);
  if (!pageCandidate) {
    throw new Error(
      `ChangelogCatchAllRoute rendered with no resolvable page for splat "${_splat}". beforeLoad should have thrown notFound().`
    );
  }

  const MdxComponent = mdxModules[pageCandidate.globKey]?.default;
  if (!MdxComponent) {
    return <MissingMdxModule urlPath={pageCandidate.urlPath} />;
  }

  return (
    <DocsShell>
      <MdxComponent />
    </DocsShell>
  );
}
