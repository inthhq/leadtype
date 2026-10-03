<script setup lang="ts">
// biome-ignore lint/correctness/noUnusedImports: Nuxt dev servers can keep stale auto-import component paths after route refactors.
import DocsPageShell from "../../components/docs-page-shell.vue";
</script>

<template>
  <component :is="DocsPageShell" slug="" />
</template>
