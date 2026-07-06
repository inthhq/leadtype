import { rehypeCode } from "fumadocs-core/mdx-plugins";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import {
  createDocsJsonLd,
  normalizeAgentReadabilityManifest,
  stringifyJsonLd,
} from "leadtype/llm/readability";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote-client/rsc";
import { mdxComponents } from "@/lib/mdx-components";
import { leadtypeSource } from "@/lib/source";
import manifestJson from "../../../public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

const mdxOptions = {
  rehypePlugins: [rehypeCode],
};

type PageParams = Promise<{ slug?: string[] }>;

function sourceSlug(slug: string[]): string[] {
  return ["changelog", ...slug];
}

export default async function ChangelogPageRoute({
  params,
}: {
  params: PageParams;
}) {
  const { slug = [] } = await params;
  const page = await leadtypeSource.loadPage(sourceSlug(slug));

  if (!page?.urlPath.startsWith("/changelog/")) {
    notFound();
  }

  const jsonLd = createDocsJsonLd({ urlPath: page.urlPath, manifest });

  return (
    <DocsPage
      toc={page.toc.map((item) => ({
        title: item.title,
        url: `#${item.id}`,
        depth: item.level,
      }))}
    >
      {jsonLd ? (
        <script type="application/ld+json">{stringifyJsonLd(jsonLd)}</script>
      ) : null}
      <DocsTitle>{page.title}</DocsTitle>
      {page.description ? (
        <DocsDescription>{page.description}</DocsDescription>
      ) : null}
      <DocsBody>
        <MDXRemote
          components={mdxComponents}
          options={{ mdxOptions }}
          source={page.markdown}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  const pages = await leadtypeSource.listPages();
  return pages
    .filter((page) => page.urlPath.startsWith("/changelog/"))
    .map((page) => ({ slug: page.slug.slice(1) }));
}

export async function generateMetadata({
  params,
}: {
  params: PageParams;
}): Promise<Metadata> {
  const { slug = [] } = await params;
  const page = await leadtypeSource.loadPage(sourceSlug(slug));
  if (!page) {
    return {};
  }
  const meta = manifest.pages.find((entry) => entry.urlPath === page.urlPath);
  return {
    title: `${page.title} — Leadtype docs`,
    description: page.description,
    alternates: meta
      ? {
          canonical: meta.absoluteUrl,
          types: { "text/markdown": meta.markdownAbsoluteUrl },
        }
      : undefined,
  };
}
