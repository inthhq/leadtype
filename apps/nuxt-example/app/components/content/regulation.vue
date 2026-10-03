<script setup lang="ts">
defineProps<{ region?: string }>();
</script>

<template>
  <blockquote class="regulation">
    <strong>{{ region ?? "Regulation" }}</strong>
    <div><slot /></div>
  </blockquote>
</template>
