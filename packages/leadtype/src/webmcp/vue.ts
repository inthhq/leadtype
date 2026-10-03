import { onMounted, onUnmounted } from "vue";
import {
  type RegisterDocsWebMcpToolsOptions,
  type RegisterWebMcpToolsResult,
  registerDocsWebMcpTools,
} from "./index.js";

/**
 * Register the generated docs as browser WebMCP tools for the lifetime of the
 * component. Call during component setup (for example, the root layout or an
 * `app.vue` setup block).
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useLeadtypeWebMcp } from "leadtype/webmcp/vue";
 *
 * useLeadtypeWebMcp();
 * </script>
 * ```
 */
export function useLeadtypeWebMcp(
  options: RegisterDocsWebMcpToolsOptions = {}
): void {
  let registration: RegisterWebMcpToolsResult | undefined;
  onMounted(() => {
    registration = registerDocsWebMcpTools(options);
  });
  onUnmounted(() => {
    registration?.unregister();
  });
}
