<script lang="ts">
import "../app.css";
import { useLeadtypeWebMcp } from "leadtype/webmcp/svelte";

let { children } = $props();

useLeadtypeWebMcp();
</script>

{@render children()}
