import { defineNuxtConfig } from "nuxt/config";

export default defineNuxtConfig({
  compatibilityDate: "2026-05-15",
  modules: ["@nuxtjs/mdc"],
  css: ["~/assets/styles.css"],
  // Register the MDX component renderers globally with no path prefix so MDC
  // resolves `::callout` → <Callout> (not the auto-import default <ContentCallout>)
  // and they are available for MDC's runtime dynamic rendering.
  components: [
    { path: "~/components/content", pathPrefix: false, global: true },
    "~/components",
  ],
});
