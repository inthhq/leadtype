import { chmod, rm } from "node:fs/promises";
import { defineConfig, type Plugin, type RenderedChunk } from "rollup";
import dts from "rollup-plugin-dts";
import esbuild from "rollup-plugin-esbuild";

const entries = {
  index: "src/index.ts",
  "mdx/index": "src/mdx/index.ts",
  "fumadocs/index": "src/fumadocs/index.ts",
  "astro/index": "src/astro/index.ts",
  "i18n/index": "src/i18n/index.ts",
  "nuxt/index": "src/nuxt/index.ts",
  "next/index": "src/next/index.ts",
  "next/client": "src/next/client.ts",
  "remark/index": "src/remark/index.ts",
  "convert/index": "src/convert/index.ts",
  "llm/index": "src/llm/index.ts",
  "llm/readability": "src/llm/readability.ts",
  "search/index": "src/search/index.ts",
  "search/client": "src/search/client.ts",
  "search/react": "src/search/react.ts",
  "search/vue": "src/search/vue.ts",
  "search/svelte": "src/search/svelte.ts",
  "search/node-index": "src/search/node-index.ts",
  "search/ai-index": "src/search/ai-index.ts",
  "search/bash-index": "src/search/bash-index.ts",
  "search/vercel-index": "src/search/vercel-index.ts",
  "search/tanstack-index": "src/search/tanstack-index.ts",
  "search/cloudflare-index": "src/search/cloudflare-index.ts",
  "sveltekit/index": "src/sveltekit/index.ts",
  "tanstack-start/index": "src/tanstack-start/index.ts",
  "lint/index": "src/lint/index.ts",
  cli: "src/cli.ts",
} as const;

const isExternal = (id: string) =>
  id.startsWith("node:") || !(id.startsWith(".") || id.startsWith("/"));

const cliShebang = (chunk: RenderedChunk) =>
  chunk.name === "cli" ? "#!/usr/bin/env node" : "";

const chmodCli: Plugin = {
  name: "chmod-cli",
  async writeBundle(options, bundle) {
    if (bundle["cli.js"] && options.dir) {
      await chmod(`${options.dir}/cli.js`, 0o755);
    }
  },
};

const cleanDist: Plugin = {
  name: "clean-dist",
  async buildStart() {
    await rm("dist", { recursive: true, force: true });
  },
};

export default defineConfig([
  {
    input: entries,
    output: {
      dir: "dist",
      format: "esm",
      sourcemap: true,
      entryFileNames: "[name].js",
      chunkFileNames: "_shared/[name]-[hash].js",
      banner: cliShebang,
    },
    external: isExternal,
    plugins: [cleanDist, esbuild({ target: "es2022" }), chmodCli],
  },
  {
    input: entries,
    output: {
      dir: "dist",
      format: "esm",
      entryFileNames: "[name].d.ts",
      chunkFileNames: "_shared/[name]-[hash].d.ts",
    },
    external: isExternal,
    plugins: [dts({ compilerOptions: { ignoreDeprecations: "6.0" } })],
  },
]);
