<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "#imports";
// biome-ignore lint/correctness/noUnusedImports: Nuxt dev servers can keep stale auto-import component paths after route refactors.
import DocsPageShell from "../../components/docs-page-shell.vue";

const route = useRoute();
const slug = computed(() => {
  const value = route.params.slug;

  if (Array.isArray(value)) {
    return value.join("/");
  }

  return typeof value === "string" ? value : "";
});
</script>

<template>
  <component :is="DocsPageShell" prefix="/changelog" :slug="slug" />
</template>
