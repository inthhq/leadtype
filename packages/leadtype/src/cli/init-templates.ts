/**
 * Scaffold templates for `leadtype init`. These are inert string payloads —
 * the framework `import` lines inside them are the code we generate into a
 * consumer's app, NOT imports of this module. The core/adapter boundary test
 * skips this file for that reason; keep real logic in `init.ts`, which stays
 * under the boundary guard.
 */

export type InitFramework = "astro" | "next" | "nuxt" | "sveltekit";

export const SUPPORTED_FRAMEWORKS: InitFramework[] = [
  "next",
  "astro",
  "nuxt",
  "sveltekit",
];

/** Frameworks with heavier, app-specific setup — pointed at a docs recipe. */
export const RECIPE_FRAMEWORKS = ["tanstack", "fumadocs"] as const;

export type InitFile = { contents: string; path: string };

export type FrameworkPlan = {
  deps: string[];
  devCommand: string;
  files: InitFile[];
  outDir: string;
};

export function isInitFramework(value: string): value is InitFramework {
  return (SUPPORTED_FRAMEWORKS as string[]).includes(value);
}

export function sharedFiles(name: string, summary: string): InitFile[] {
  const configBody = `import { defineDocsConfig } from "leadtype";

export default defineDocsConfig({
  product: {
    name: ${JSON.stringify(name)},
    summary: ${JSON.stringify(summary)},
    // \`blocks\` is the body of llms.txt and AGENTS.md, rendered in order.
    blocks: [
      {
        type: "links",
        heading: "Best Starting Points",
        links: [
          {
            urlPath: "/docs",
            title: "Start here",
            description: "Overview and first steps.",
          },
        ],
      },
    ],
  },
  // \`nav\` is the single source of truth for the sidebar, llms.txt, AGENTS.md,
  // sitemap, and agent-readability metadata.
  nav: [{ title: "Start", pages: [""] }],
});
`;

  const indexBody = `---
title: ${JSON.stringify(name)}
description: ${JSON.stringify(summary)}
---

# ${name}

Welcome. This page renders for humans and is mirrored as markdown for agents.
`;

  return [
    { path: "docs/docs.config.ts", contents: configBody },
    { path: "docs/index.mdx", contents: indexBody },
  ];
}

function nextPlan(baseUrl: string): FrameworkPlan {
  return {
    outDir: "public",
    devCommand: "next dev",
    deps: ["next", "react", "react-dom", "@next/mdx", "next-mdx-remote-client"],
    files: [
      {
        path: "next.config.mjs",
        contents: `import path from "node:path";
import createMDX from "@next/mdx";
import { createMdxSourcePlugins } from "leadtype/mdx";

const withMdx = createMDX({
  options: {
    remarkPlugins: [
      ...createMdxSourcePlugins({
        typeTableBasePath: path.resolve(process.cwd(), "docs"),
      }),
    ],
  },
});

export default withMdx({ pageExtensions: ["ts", "tsx", "mdx"] });
`,
      },
      {
        path: "lib/source.ts",
        contents: `import path from "node:path";
import { createDocsSource } from "leadtype";
import docsConfig from "../docs/docs.config";

export const source = await createDocsSource({
  contentDir: path.resolve(process.cwd(), "docs"),
  nav: docsConfig.nav,
  baseUrl: ${JSON.stringify(baseUrl)},
});
`,
      },
      {
        path: "lib/mdx-components.tsx",
        contents: `import type { MDXComponents } from "mdx/types";

// Map your custom MDX components here. Empty is fine to start.
export const mdxComponents: MDXComponents = {};
`,
      },
      {
        path: "app/docs/[[...slug]]/page.tsx",
        contents: `import {
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
import { mdxComponents } from "../../../lib/mdx-components";
import { source } from "../../../lib/source";
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

  const jsonLd = createDocsJsonLd({ urlPath: page.urlPath, manifest });

  return (
    <main>
      {jsonLd ? (
        <script type="application/ld+json">{stringifyJsonLd(jsonLd)}</script>
      ) : null}
      <article>
        <MDXRemote components={mdxComponents} source={page.markdown} />
      </article>
    </main>
  );
}
`,
      },
    ],
  };
}

function astroPlan(baseUrl: string): FrameworkPlan {
  return {
    outDir: "public",
    devCommand: "astro dev",
    deps: ["astro", "@astrojs/mdx"],
    files: [
      {
        path: "astro.config.mjs",
        contents: `import path from "node:path";
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { createMdxSourcePlugins } from "leadtype/mdx";

export default defineConfig({
  integrations: [
    mdx({
      remarkPlugins: [
        ...createMdxSourcePlugins({
          typeTableBasePath: path.resolve(process.cwd(), "docs"),
        }),
      ],
    }),
  ],
});
`,
      },
      {
        path: "src/lib/source.ts",
        contents: `import path from "node:path";
import { createDocsSource } from "leadtype";
import docsConfig from "../../docs/docs.config";

export const source = await createDocsSource({
  contentDir: path.resolve(process.cwd(), "docs"),
  nav: docsConfig.nav,
  baseUrl: ${JSON.stringify(baseUrl)},
});
`,
      },
      {
        path: "src/pages/docs/[...slug].astro",
        contents: `---
import { createGetStaticPaths, createLoadPageData } from "leadtype/astro";
import { source } from "../../lib/source";

export const getStaticPaths = createGetStaticPaths({ source });

const loadPageData = createLoadPageData({ source });
const page = await loadPageData(Astro.params.slug);

if (!page) {
  return Astro.redirect("/docs");
}

const markdownHref = page.urlPath === "/docs" ? "/docs/index.md" : \`\${page.urlPath}.md\`;
---

<html lang="en">
  <head>
    <title>{page.title}</title>
  </head>
  <body>
    <main>
      <aside>
        <a href="/llms.txt">llms.txt</a>
        <a href={markdownHref}>Markdown</a>
      </aside>
      <article>
        <pre>{page.markdown}</pre>
      </article>
    </main>
  </body>
</html>
`,
      },
      {
        path: "src/pages/docs/[...slug].md.ts",
        contents: `import { createDocsEndpoint, createMarkdownStaticPaths } from "leadtype/astro";
import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import manifestJson from "../../../public/docs/agent-readability.json";
import { source } from "../../lib/source";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

export const getStaticPaths = createMarkdownStaticPaths({ source });
export const GET = createDocsEndpoint({ manifest });
export const HEAD = GET;
`,
      },
    ],
  };
}

function nuxtPlan(baseUrl: string): FrameworkPlan {
  return {
    outDir: "public",
    devCommand: "nuxt dev",
    deps: ["nuxt", "vue"],
    files: [
      {
        path: "lib/source.ts",
        contents: `import path from "node:path";
import { createDocsSource } from "leadtype";
import docsConfig from "../docs/docs.config";

let sourcePromise: ReturnType<typeof createDocsSource> | undefined;

export function getSource() {
  sourcePromise ??= createDocsSource({
    contentDir: path.resolve(process.cwd(), "docs"),
    nav: docsConfig.nav,
    baseUrl: ${JSON.stringify(baseUrl)},
  });
  return sourcePromise;
}
`,
      },
      {
        path: "server/api/docs.get.ts",
        contents: `import { createError, defineEventHandler, getQuery } from "h3";
import { createLoadPageData } from "leadtype/nuxt";
import { getSource } from "../../lib/source";

export default defineEventHandler(async (event) => {
  const source = await getSource();
  const loadPageData = createLoadPageData({ source });
  const query = getQuery(event);
  const slug = typeof query.slug === "string" ? query.slug : "";
  const page = await loadPageData({ slug: slug ? slug.split("/") : [] });
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: "Page not found" });
  }
  return {
    title: page.title,
    urlPath: page.urlPath,
    markdownUrlPath:
      page.urlPath === "/docs" ? "/docs/index.md" : \`\${page.urlPath}.md\`,
    markdown: page.markdown,
  };
});
`,
      },
      {
        path: "server/routes/docs/[...slug].md.ts",
        contents: `import { defineEventHandler } from "h3";
import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import { createRequiredNitroDocsHandler } from "leadtype/nuxt";
import manifestJson from "../../../public/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

export default defineEventHandler(createRequiredNitroDocsHandler({ manifest }));
`,
      },
      {
        path: "app/pages/docs/[...slug].vue",
        contents: `<script setup lang="ts">
const route = useRoute();
const slug = computed(() => {
  const value = route.params.slug;
  return Array.isArray(value) ? value.join("/") : (value ?? "");
});
const { data: page } = await useFetch("/api/docs", { query: { slug } });
</script>

<template>
  <main v-if="page">
    <aside>
      <a href="/llms.txt">llms.txt</a>
      <a :href="page.markdownUrlPath">Markdown</a>
    </aside>
    <article>
      <pre>{{ page.markdown }}</pre>
    </article>
  </main>
</template>
`,
      },
      {
        path: "nuxt.config.ts",
        contents: `import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  compatibilityDate: "2026-05-15",
});
`,
      },
    ],
  };
}

function sveltekitPlan(baseUrl: string): FrameworkPlan {
  return {
    outDir: "static",
    devCommand: "vite dev",
    deps: [
      "@sveltejs/kit",
      "@sveltejs/vite-plugin-svelte",
      "@sveltejs/adapter-auto",
      "svelte",
      "vite",
      "mdsvex",
    ],
    files: [
      {
        path: "svelte.config.js",
        contents: `import path from "node:path";
import adapter from "@sveltejs/adapter-auto";
import { createMdxSourcePlugins } from "leadtype/mdx";
import { mdsvex } from "mdsvex";

export default {
  extensions: [".svelte", ".svx", ".mdx"],
  preprocess: [
    mdsvex({
      extensions: [".svx", ".mdx"],
      remarkPlugins: [
        ...createMdxSourcePlugins({
          typeTableBasePath: path.resolve(process.cwd(), "docs"),
        }),
      ],
    }),
  ],
  kit: { adapter: adapter() },
};
`,
      },
      {
        path: "src/lib/source.ts",
        contents: `import path from "node:path";
import { createDocsSource } from "leadtype";
import docsConfig from "../../docs/docs.config";

export const source = await createDocsSource({
  contentDir: path.resolve(process.cwd(), "docs"),
  nav: docsConfig.nav,
  baseUrl: ${JSON.stringify(baseUrl)},
});
`,
      },
      {
        path: "src/routes/docs/[...slug]/+page.server.ts",
        contents: `import { error } from "@sveltejs/kit";
import { createEntries, createLoadPageData } from "leadtype/sveltekit";
import { source } from "$lib/source";
import type { PageServerLoad } from "./$types";

export const entries = createEntries({ source });
export const prerender = true;

const loadPageData = createLoadPageData({ source });

export const load: PageServerLoad = async (event) => {
  const page = await loadPageData(event);
  if (!page) {
    throw error(404, "Page not found");
  }
  return {
    page: {
      title: page.title,
      urlPath: page.urlPath,
      markdownUrlPath:
        page.urlPath === "/docs" ? "/docs/index.md" : \`\${page.urlPath}.md\`,
      markdown: page.markdown,
    },
  };
};
`,
      },
      {
        path: "src/routes/docs/[...slug]/+page.svelte",
        contents: `<script lang="ts">
  let { data } = $props();
</script>

<main>
  <aside>
    <a href="/llms.txt">llms.txt</a>
    <a href={data.page.markdownUrlPath}>Markdown</a>
  </aside>
  <article>
    <pre>{data.page.markdown}</pre>
  </article>
</main>
`,
      },
      {
        path: "src/routes/docs/[...slug].md/+server.ts",
        contents: `import { normalizeAgentReadabilityManifest } from "leadtype/llm/readability";
import { createDocsServerHandler } from "leadtype/sveltekit";
import manifestJson from "../../../../static/docs/agent-readability.json";

const manifest = normalizeAgentReadabilityManifest(manifestJson);

export const GET = createDocsServerHandler({ manifest, publicDir: "static" });
export const HEAD = GET;
`,
      },
    ],
  };
}

export function defaultBaseUrl(framework: InitFramework): string {
  switch (framework) {
    case "astro":
      return "http://localhost:4321";
    case "sveltekit":
      return "http://localhost:5173";
    default:
      return "http://localhost:3000";
  }
}

export function buildPlan(
  framework: InitFramework,
  baseUrl: string
): FrameworkPlan {
  switch (framework) {
    case "next":
      return nextPlan(baseUrl);
    case "astro":
      return astroPlan(baseUrl);
    case "nuxt":
      return nuxtPlan(baseUrl);
    case "sveltekit":
      return sveltekitPlan(baseUrl);
    default: {
      const exhaustive: never = framework;
      throw new Error(`unhandled framework: ${String(exhaustive)}`);
    }
  }
}
