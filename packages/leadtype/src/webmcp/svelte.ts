import { onMount } from "svelte";
import {
  type RegisterDocsWebMcpToolsOptions,
  registerDocsWebMcpTools,
} from "./index.js";

/**
 * Register the generated docs as browser WebMCP tools for the lifetime of the
 * component. Call during component initialization (for example, the root
 * `+layout.svelte`).
 *
 * @example
 * ```svelte
 * <script lang="ts">
 * import { useLeadtypeWebMcp } from "leadtype/webmcp/svelte";
 *
 * useLeadtypeWebMcp();
 * </script>
 * ```
 */
export function useLeadtypeWebMcp(
  options: RegisterDocsWebMcpToolsOptions = {}
): void {
  onMount(() => {
    const registration = registerDocsWebMcpTools(options);
    return () => {
      registration.unregister();
    };
  });
}
