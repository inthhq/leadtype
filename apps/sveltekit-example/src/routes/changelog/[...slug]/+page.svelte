<script lang="ts">
import type { DocsTableOfContentsItem } from "leadtype/llm/readability";
import { createLeadtypeSearch } from "leadtype/search/svelte";
import { nav } from "$lib/manifest";
import type { PageData } from "./$types";

type FlatTocItem = DocsTableOfContentsItem & {
  depth: number;
};

let { data }: { data: PageData } = $props();

let searchQuery = $state("");

const tabs = nav.getHeaderTabs();
const sections = $derived(nav.getSidebarSections(data.urlPath));
const breadcrumbs = $derived(nav.getBreadcrumbs(data.urlPath));
const adjacent = $derived(nav.getAdjacentPages(data.urlPath));
const tocItems = $derived(flattenToc(data.toc));

const { results, search, status } = createLeadtypeSearch("docs");
const visibleResults = $derived(searchQuery.trim() ? $results.slice(0, 6) : []);

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
  searchQuery = (event.currentTarget as HTMLInputElement).value;
  search(searchQuery);
}
</script>

<svelte:head>
  <title>{data.title} | Leadtype</title>
</svelte:head>

<div class="docs-shell">
  <header class="site-header">
    <div class="site-header-inner">
      <a class="brand" href="/docs" aria-label="Leadtype docs">leadtype</a>
      <div class="header-actions">
        <section class="search-shell">
          <label class="search-label" for="docs-search">Search docs</label>
          <div class="search-field">
            <span aria-hidden="true" class="search-icon">⌕</span>
            <input
              autocomplete="off"
              id="docs-search"
              oninput={handleSearchInput}
              placeholder="Search docs"
              value={searchQuery}
            />
            <kbd>⌘K</kbd>
          </div>
          {#if searchQuery.trim()}
            <div class="search-popover">
              <span aria-live="polite" class="search-status">{$status}</span>
              {#if visibleResults.length > 0}
                <ul>
                  {#each visibleResults as result (result.id)}
                    <li>
                      <a href={result.urlWithHash}>
                        <strong>{result.title}</strong>
                        <span>{result.excerpt}</span>
                      </a>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </section>
        <nav aria-label="Primary" class="top-nav">
          <a
            aria-label="View as Markdown"
            class="agent-link"
            href={data.markdownUrlPath}
            rel="noopener"
            target="_blank"
            title="View as Markdown"
          >
            <span aria-hidden="true">☷</span>
          </a>
          {#each tabs as tab (tab.groupKey ?? tab.to)}
            <a
              aria-current={nav.isHeaderTabActive(data.urlPath, tab)
                ? "page"
                : undefined}
              href={tab.to}>{tab.label}</a
            >
          {/each}
        </nav>
      </div>
    </div>
  </header>

  <div class:has-toc={tocItems.length > 0} class="docs-layout">
    <aside class="docs-sidebar">
      {#each sections as section (section.title)}
        <section class="docs-section">
          <h2>{section.title}</h2>
          <nav aria-label={`${section.title} documentation`}>
            {#each section.links as link (link.to)}
              <a
                aria-current={link.to === data.urlPath ? "page" : undefined}
                href={link.to}>{link.label}</a
              >
            {/each}
          </nav>
        </section>
      {/each}
    </aside>

    <main class="docs-card">
      {#if breadcrumbs.length > 0}
        <nav aria-label="Breadcrumb" class="breadcrumbs">
          {#each breadcrumbs as crumb, index (crumb.to + crumb.label)}
            <a
              aria-current={index === breadcrumbs.length - 1
                ? "page"
                : undefined}
              href={crumb.to}>{crumb.label}</a
            >
          {/each}
        </nav>
      {/if}

      <section class="docs-prose">
        <header>
          <h1>{data.title}</h1>
          {#if data.description}
            <p>{data.description}</p>
          {/if}
        </header>
        {@html data.html}
      </section>

      <nav aria-label="Pagination" class="page-nav">
        {#if adjacent.previous}
          <a href={adjacent.previous.urlPath} rel="prev">
            <span>Previous</span>
            {adjacent.previous.title}
          </a>
        {:else}
          <span aria-hidden="true"></span>
        {/if}
        {#if adjacent.next}
          <a href={adjacent.next.urlPath} rel="next">
            <span>Next</span>
            {adjacent.next.title}
          </a>
        {/if}
      </nav>
    </main>

    {#if tocItems.length > 0}
      <aside class="toc-rail">
        <nav aria-label="On this page">
          <h2>On this page</h2>
          <ol>
            {#each tocItems as item (item.urlWithHash)}
              <li class:toc-child={item.depth > 0}>
                <a href={item.urlWithHash}>{item.title}</a>
              </li>
            {/each}
          </ol>
        </nav>
      </aside>
    {/if}
  </div>
</div>
