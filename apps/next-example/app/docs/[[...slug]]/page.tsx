import { createGenerateStaticParams, createLoadPageData } from "leadtype/next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote-client/rsc";
import { SearchBox } from "@/components/search-box";
import { mdxComponents } from "@/lib/mdx-components";
import { source } from "@/lib/source";

const loadPageData = createLoadPageData({ source });
export const generateStaticParams = createGenerateStaticParams({ source });

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const page = await loadPageData((await params).slug);
  if (!page) {
    notFound();
  }

  return (
    <main className="docs-layout">
      <aside>
        <a href="/llms.txt">llms.txt</a>
        <a href="/llms-full.txt">llms-full.txt</a>
        <a
          href={
            page.urlPath === "/docs" ? "/docs/index.md" : `${page.urlPath}.md`
          }
        >
          Markdown
        </a>
      </aside>
      <article>
        <SearchBox />
        <MDXRemote components={mdxComponents} source={page.markdown} />
      </article>
    </main>
  );
}
