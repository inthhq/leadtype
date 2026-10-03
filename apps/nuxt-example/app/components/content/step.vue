<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <li class="step">
    <strong v-if="title" class="step-title">{{ title }}</strong>
    <div><slot /></div>
  </li>
</template>
