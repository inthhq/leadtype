<!-- biome-ignore-all lint/correctness/noUnusedVariables lint/correctness/useHookAtTopLevel: Nuxt auto-imports and Vue template references are resolved by Nuxt. -->
<script setup lang="ts">
import { useLeadtypeSearch } from "leadtype/search/vue";
import { computed } from "vue";
import { createError, useAsyncData, useRoute } from "#app";

const route = useRoute();
interface PageData {
  markdown: string;
  markdownUrlPath: string;
  title: string;
  urlPath: string;
}
let slug = "";
if (Array.isArray(route.params.slug)) {
  slug = route.params.slug.join("/");
} else if (typeof route.params.slug === "string") {
  slug = route.params.slug;
}
const { data: pageData, error } = await useAsyncData<PageData>(
  `docs:${slug}`,
  () => $fetch("/api/docs", { query: { slug } })
);

if (error.value || !pageData.value) {
  throw createError({ statusCode: 404, statusMessage: "Page not found" });
}

const page = computed(() => pageData.value as PageData);
const docsSearch = useLeadtypeSearch("docs");
</script>

<template>
  <main class="docs-layout">
    <aside>
      <a href="/llms.txt">llms.txt</a>
      <a href="/llms-full.txt">llms-full.txt</a>
      <a :href="page.markdownUrlPath">Markdown</a>
    </aside>
    <article>
      <section class="search">
        <input
          aria-label="Search docs"
          placeholder="Search docs"
          @input="docsSearch.search(($event.currentTarget as HTMLInputElement).value)"
        />
        <span>{{ docsSearch.status }}</span>
        <ul>
          <li v-for="result in docsSearch.results.value" :key="result.id">
            <a :href="result.urlWithHash">{{ result.title }}</a>
            <p>{{ result.excerpt }}</p>
          </li>
        </ul>
      </section>
      <pre class="markdown">{{ page.markdown }}</pre>
    </article>
  </main>
</template>
