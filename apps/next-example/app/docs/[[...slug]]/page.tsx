import {
  createDocsJsonLd,
  normalizeAgentReadabilityManifest,
  stringifyJsonLd,
} from "leadtype/llm/readability";
import {
  createGenerateMetadata,
  createGenerateStaticParams,
  createLoadPageData,
} from "leadtype/next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote-client/rsc";
import { SearchBox } from "@/components/search-box";
import { mdxComponents } from "@/lib/mdx-components";
import { source } from "@/lib/source";
import manifestJson from "../../../public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);
const loadPageData = createLoadPageData({ source });
export const generateStaticParams = createGenerateStaticParams({ source });
export const generateMetadata = createGenerateMetadata({ manifest });

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const page = await loadPageData((await params).slug);
  if (!page) {
    notFound();
  }

  const jsonLd = createDocsJsonLd({
    urlPath: page.urlPath,
    manifest,
    overrides: {
      publisher: {
        "@type": "Organization",
        name: manifest.product.name,
      },
    },
  });

  return (
    <main className="docs-layout">
      {jsonLd ? (
        <script type="application/ld+json">{stringifyJsonLd(jsonLd)}</script>
      ) : null}
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
