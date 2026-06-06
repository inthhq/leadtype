<script lang="ts">
import { onMount } from "svelte";
import "../app.css";
import { createDocsWebMcpTools, registerWebMcpTools } from "leadtype/webmcp";

let { children } = $props();

onMount(() => {
  const registration = registerWebMcpTools(createDocsWebMcpTools());
  return () => {
    registration.unregister();
  };
});
</script>

{@render children()}
