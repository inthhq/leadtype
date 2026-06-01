<script lang="ts">
import { createLeadtypeSearch } from "leadtype/search/svelte";

let {
  data,
}: {
  data: {
    page: {
      title: string;
      urlPath: string;
      markdownUrlPath: string;
      markdown: string;
      canonicalUrl: string | null;
      markdownAbsoluteUrl: string | null;
      jsonLdScript: string | null;
    };
  };
} = $props();

const { results, search, status } = createLeadtypeSearch("docs");
</script>

<svelte:head>
  {#if data.page.canonicalUrl}
    <link rel="canonical" href={data.page.canonicalUrl} />
  {/if}
  {#if data.page.markdownAbsoluteUrl}
    <link rel="alternate" type="text/markdown" href={data.page.markdownAbsoluteUrl} />
  {/if}
  {#if data.page.jsonLdScript}
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html data.page.jsonLdScript}
  {/if}
</svelte:head>

<main class="docs-layout">
  <aside>
    <a href="/llms.txt">llms.txt</a>
    <a href="/llms-full.txt">llms-full.txt</a>
    <a href={data.page.markdownUrlPath}>Markdown</a>
  </aside>
  <article>
    <section class="search">
      <input
        aria-label="Search docs"
        oninput={(event) =>
          search((event.currentTarget as HTMLInputElement).value)}
        placeholder="Search docs"
      />
      <span>{$status}</span>
      <ul>
        {#each $results as result}
          <li>
            <a href={result.urlWithHash}>{result.title}</a>
            <p>{result.excerpt}</p>
          </li>
        {/each}
      </ul>
    </section>
    <pre class="markdown">{data.page.markdown}</pre>
  </article>
</main>
