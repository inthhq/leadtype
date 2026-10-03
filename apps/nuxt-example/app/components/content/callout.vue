<script setup lang="ts">
defineProps<{ title?: string; variant?: string }>();
</script>

<template>
  <aside class="callout">
    <strong v-if="title" class="callout-title">{{ title }}</strong>
    <div><slot /></div>
  </aside>
</template>
