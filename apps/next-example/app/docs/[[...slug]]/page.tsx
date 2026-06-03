import { createDocsJsonLd, stringifyJsonLd } from "leadtype/llm/readability";
import { notFound } from "next/navigation";
import { loadDocsMdx, mdxSlugs } from "@/app/generated/docs-mdx-map";
import { DocsSidebar } from "@/components/docs-sidebar";
import { SearchBox } from "@/components/search-box";
import { manifest, nav, pageForUrlPath } from "@/lib/manifest";

function urlPathForSlug(slug: string[] | undefined): string {
  return slug && slug.length > 0 ? `/docs/${slug.join("/")}` : "/docs";
}

export function generateStaticParams(): Array<{ slug: string[] }> {
  return mdxSlugs.map((slug) => ({ slug: slug === "" ? [] : slug.split("/") }));
}

export default async function DocsPage({
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

  const mdxModule = await loadDocsMdx(slug ?? []);
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
          <a href={urlPath === "/docs" ? "/docs/index.md" : `${urlPath}.md`}>
            Markdown
          </a>
        </footer>
      </main>
    </div>
  );
}
