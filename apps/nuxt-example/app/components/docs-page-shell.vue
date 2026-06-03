<script setup lang="ts">
import type { DocsTableOfContentsItem } from "leadtype/llm/readability";
import {
  createDocsJsonLd,
  normalizeAgentReadabilityManifest,
  stringifyJsonLd,
} from "leadtype/llm/readability";
import { createDocsNavigation } from "leadtype/navigation";
import { useLeadtypeSearch } from "leadtype/search/vue";
import { computed, ref } from "vue";
import { createError, useAsyncData, useHead } from "#imports";
import manifestJson from "../../public/docs/agent-readability.json";

const props = defineProps<{
  slug?: string;
}>();

const manifest = normalizeAgentReadabilityManifest(manifestJson);
const nav = createDocsNavigation(manifest.navigation);
const currentSlug = computed(() => props.slug ?? "");

type FlatTocItem = DocsTableOfContentsItem & {
  depth: number;
};

interface PageData {
  markdownUrlPath: string;
  mdc: string;
  title: string;
  toc: DocsTableOfContentsItem[];
  urlPath: string;
}

const { data: pageData, error } = await useAsyncData<PageData>(
  () => `docs:${currentSlug.value}`,
  () => $fetch("/api/docs", { query: { slug: currentSlug.value } }),
  { watch: [currentSlug] }
);

if (error.value || !pageData.value) {
  throw createError({ statusCode: 404, statusMessage: "Page not found" });
}

const page = computed(() => pageData.value as PageData);
const searchQuery = ref("");
const tabs = nav.getHeaderTabs();
const sections = computed(() => nav.getSidebarSections(page.value.urlPath));
const adjacent = computed(() => nav.getAdjacentPages(page.value.urlPath));
const tocItems = computed(() => flattenToc(page.value.toc));
const docsSearch = useLeadtypeSearch("docs");
const visibleResults = computed(() =>
  searchQuery.value.trim() ? docsSearch.results.value.slice(0, 6) : []
);

const meta = computed(() =>
  manifest.pages.find((entry) => entry.urlPath === page.value.urlPath)
);
const jsonLd = computed(() =>
  createDocsJsonLd({ urlPath: page.value.urlPath, manifest })
);

function flattenToc(
  items: DocsTableOfContentsItem[],
  depth = 0
): FlatTocItem[] {
  return items.flatMap((item) => [
    { ...item, depth },
    ...flattenToc(item.children, depth + 1),
  ]);
}

function handleSearchInput(event: Event) {
  searchQuery.value = (event.currentTarget as HTMLInputElement).value;
  docsSearch.search(searchQuery.value).catch(() => undefined);
}

useHead(() => ({
  title: `${page.value.title} | Leadtype`,
  link: meta.value
    ? [
        { rel: "canonical", href: meta.value.absoluteUrl },
        {
          rel: "alternate",
          type: "text/markdown",
          href: meta.value.markdownAbsoluteUrl,
        },
      ]
    : [],
  script: jsonLd.value
    ? [
        {
          type: "application/ld+json",
          innerHTML: stringifyJsonLd(jsonLd.value),
        },
      ]
    : [],
}));
</script>

<template>
  <div class="docs-shell">
    <header class="site-header">
      <div class="site-header-inner">
        <NuxtLink aria-label="Leadtype docs" class="brand" to="/docs">
          leadtype
        </NuxtLink>
        <div class="header-actions">
          <section class="search-shell">
            <label class="search-label" for="docs-search">Search docs</label>
            <div class="search-field">
              <span aria-hidden="true" class="search-icon">⌕</span>
              <input
                id="docs-search"
                autocomplete="off"
                placeholder="Search docs"
                :value="searchQuery"
                @input="handleSearchInput"
              />
              <kbd>⌘K</kbd>
            </div>
            <div v-if="searchQuery.trim()" class="search-popover">
              <span aria-live="polite" class="search-status">{{
                docsSearch.status
              }}</span>
              <ul v-if="visibleResults.length > 0">
                <li v-for="result in visibleResults" :key="result.id">
                  <a :href="result.urlWithHash">
                    <strong>{{ result.title }}</strong>
                    <span>{{ result.excerpt }}</span>
                  </a>
                </li>
              </ul>
            </div>
          </section>
          <nav aria-label="Primary" class="top-nav">
            <a
              aria-label="View as Markdown"
              class="agent-link"
              :href="page.markdownUrlPath"
              rel="noopener"
              target="_blank"
              title="View as Markdown"
            >
              <span aria-hidden="true">☷</span>
            </a>
            <NuxtLink
              v-for="tab in tabs"
              :key="tab.groupKey ?? tab.to"
              :aria-current="
                nav.isHeaderTabActive(page.urlPath, tab) ? 'page' : undefined
              "
              :to="tab.to"
            >
              {{ tab.label }}
            </NuxtLink>
          </nav>
        </div>
      </div>
    </header>

    <div class="docs-layout" :class="{ 'has-toc': tocItems.length > 0 }">
      <aside class="docs-sidebar">
        <section
          v-for="section in sections"
          :key="section.title"
          class="docs-section"
        >
          <h2>{{ section.title }}</h2>
          <nav :aria-label="`${section.title} documentation`">
            <NuxtLink
              v-for="link in section.links"
              :key="link.to"
              :aria-current="link.to === page.urlPath ? 'page' : undefined"
              :to="link.to"
            >
              {{ link.label }}
            </NuxtLink>
          </nav>
        </section>
      </aside>

      <main class="docs-card">
        <section class="docs-prose">
          <MDC :value="page.mdc" />
        </section>

        <nav aria-label="Pagination" class="page-nav">
          <NuxtLink
            v-if="adjacent.previous"
            :to="adjacent.previous.urlPath"
            rel="prev"
          >
            <span>Previous</span>
            {{ adjacent.previous.title }}
          </NuxtLink>
          <span v-else aria-hidden="true"></span>
          <NuxtLink v-if="adjacent.next" :to="adjacent.next.urlPath" rel="next">
            <span>Next</span>
            {{ adjacent.next.title }}
          </NuxtLink>
        </nav>
      </main>

      <aside v-if="tocItems.length > 0" class="toc-rail">
        <nav aria-label="On this page">
          <h2>On this page</h2>
          <ol>
            <li
              v-for="item in tocItems"
              :key="item.urlWithHash"
              :class="{ 'toc-child': item.depth > 0 }"
            >
              <a :href="item.urlWithHash">{{ item.title }}</a>
            </li>
          </ol>
        </nav>
      </aside>
    </div>
  </div>
</template>
