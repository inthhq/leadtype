import { rehypeCode } from "fumadocs-core/mdx-plugins";
import {
  PageArticle,
  PageRoot,
  PageTOC,
  PageTOCItems,
} from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote-client/rsc";
import { mdxComponents } from "@/lib/mdx-components";
import { leadtypeSource } from "@/lib/source";

const mdxOptions = {
  // Syntax highlight code blocks. Tokens use the same shiki theme + classes
  // that fumadocs-ui's codeblock CSS is designed for.
  rehypePlugins: [rehypeCode],
};

type PageParams = Promise<{ slug?: string[] }>;

export default async function DocsPage({ params }: { params: PageParams }) {
  const { slug = [] } = await params;
  const page = await leadtypeSource.loadPage(slug);

  if (!page) {
    notFound();
  }

  return (
    <PageRoot
      toc={{
        toc: page.toc.map((item) => ({
          title: item.title,
          url: `#${item.id}`,
          depth: item.level,
        })),
      }}
    >
      <PageArticle>
        <h1>{page.title}</h1>
        {page.description ? <p>{page.description}</p> : null}
        <MDXRemote
          components={mdxComponents}
          options={{ mdxOptions }}
          source={page.markdown}
        />
      </PageArticle>
      <PageTOC>
        <PageTOCItems />
      </PageTOC>
    </PageRoot>
  );
}

export async function generateStaticParams() {
  const pages = await leadtypeSource.listPages();
  return pages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: PageParams }) {
  const { slug = [] } = await params;
  const page = await leadtypeSource.loadPage(slug);
  if (!page) {
    return {};
  }
  return {
    title: `${page.title} — c15t docs`,
    description: page.description,
  };
}
