<script setup lang="ts">
defineProps<{ value?: string }>();
</script>

<template>
  <section class="tab">
    <h3 v-if="value" class="tab-label">{{ value }}</h3>
    <slot />
  </section>
</template>
