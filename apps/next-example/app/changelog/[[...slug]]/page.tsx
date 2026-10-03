import { createDocsJsonLd, stringifyJsonLd } from "leadtype/llm/readability";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadDocsMdx, mdxSlugs } from "@/app/generated/docs-mdx-map";
import { DocsSidebar } from "@/components/docs-sidebar";
import { SearchBox } from "@/components/search-box";
import { manifest, nav, pageForUrlPath } from "@/lib/manifest";

const CHANGELOG_ROOT_SLUG = "changelog";

function urlPathForSlug(slug: string[] | undefined): string {
  return slug && slug.length > 0
    ? `/changelog/${slug.join("/")}`
    : "/changelog";
}

function sourceSlugForSlug(slug: string[] | undefined): string[] {
  return [CHANGELOG_ROOT_SLUG, ...(slug ?? [])];
}

export function generateStaticParams(): Array<{ slug: string[] }> {
  return mdxSlugs
    .filter((slug) => slug.startsWith(`${CHANGELOG_ROOT_SLUG}/`))
    .map((slug) => ({
      slug: slug.slice(CHANGELOG_ROOT_SLUG.length + 1).split("/"),
    }));
}

export default async function ChangelogPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const urlPath = urlPathForSlug(slug);
  const page = pageForUrlPath(urlPath);
  if (!page) {
    notFound();
  }

  const mdxModule = await loadDocsMdx(sourceSlugForSlug(slug));
  if (!mdxModule) {
    notFound();
  }
  const MdxContent = mdxModule.default;

  const breadcrumbs = nav.getBreadcrumbs(urlPath);
  const { previous, next } = nav.getAdjacentPages(urlPath);
  const jsonLd = createDocsJsonLd({ urlPath, manifest });

  return (
    <div className="docs-layout">
      {jsonLd ? (
        <script type="application/ld+json">{stringifyJsonLd(jsonLd)}</script>
      ) : null}
      <DocsSidebar urlPath={urlPath} />
      <main className="docs-main">
        <SearchBox />
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          {breadcrumbs.map((crumb) => (
            <a href={crumb.to} key={`${crumb.to}-${crumb.label}`}>
              {crumb.label}
            </a>
          ))}
        </nav>
        <article className="docs-prose">
          <header>
            <h1>{page.title}</h1>
            {page.description ? <p>{page.description}</p> : null}
          </header>
          <MdxContent />
        </article>
        <nav aria-label="Pagination" className="page-nav">
          {previous ? (
            <a href={previous.urlPath} rel="prev">
              ← {previous.title}
            </a>
          ) : null}
          {next ? (
            <a href={next.urlPath} rel="next">
              {next.title} →
            </a>
          ) : null}
        </nav>
        <footer className="agent-links">
          <a href="/llms.txt">llms.txt</a>
          <a href={`${urlPath}.md`}>Markdown</a>
        </footer>
      </main>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = pageForUrlPath(urlPathForSlug(slug));
  if (!page) {
    return {};
  }
  return {
    title: `${page.title} | Leadtype`,
    description: page.description,
  };
}
