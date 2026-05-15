<script lang="ts">
import { createLeadtypeSearch } from "leadtype/search/svelte";

export let data: {
  page: {
    title: string;
    urlPath: string;
    markdownUrlPath: string;
    markdown: string;
  };
};

const { results, search, status } = createLeadtypeSearch("docs");
</script>

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
        on:input={(event) =>
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
