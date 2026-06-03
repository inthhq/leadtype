<script setup lang="ts">
defineProps<{ items?: string[] }>();
</script>

<template>
  <div class="tabs"><slot /></div>
</template>
