import { createDocsWebMcpTools, registerWebMcpTools } from "leadtype/webmcp";
import { defineNuxtPlugin } from "#app";

export default defineNuxtPlugin(() => {
  const registration = registerWebMcpTools(createDocsWebMcpTools());
  globalThis.addEventListener(
    "pagehide",
    () => {
      registration.unregister();
    },
    { once: true }
  );
});
