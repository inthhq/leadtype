import { registerDocsWebMcpTools } from "leadtype/webmcp";
import { defineNuxtPlugin } from "#app";

export default defineNuxtPlugin(() => {
  const registration = registerDocsWebMcpTools();
  globalThis.addEventListener(
    "pagehide",
    () => {
      registration.unregister();
    },
    { once: true }
  );
});
