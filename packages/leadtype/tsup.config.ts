import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "remark/index": "src/remark/index.ts",
    "convert/index": "src/convert/index.ts",
    "llm/index": "src/llm/index.ts",
    "llm/readability": "src/llm/readability.ts",
    "search/index": "src/search/index.ts",
    "search/node-index": "src/search/node-index.ts",
    "search/ai-index": "src/search/ai-index.ts",
    "search/bash-index": "src/search/bash-index.ts",
    "search/vercel-index": "src/search/vercel-index.ts",
    "search/tanstack-index": "src/search/tanstack-index.ts",
    "search/cloudflare-index": "src/search/cloudflare-index.ts",
    "lint/index": "src/lint/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  dts: {
    compilerOptions: {
      ignoreDeprecations: "6.0",
    },
  },
  clean: true,
  sourcemap: true,
  target: "es2022",
  splitting: false,
  treeshake: true,
  onSuccess: async () => {
    const { chmod, readFile, writeFile } = await import("node:fs/promises");
    const cli = "dist/cli.js";
    const contents = await readFile(cli, "utf8");
    if (!contents.startsWith("#!")) {
      await writeFile(cli, `#!/usr/bin/env node\n${contents}`);
    }
    await chmod(cli, 0o755);
  },
  external: [
    "typescript",
    "fs",
    "path",
    "node:fs",
    "node:path",
    "node:fs/promises",
    "ai",
    "bash-tool",
    "just-bash",
    "@tanstack/ai",
    "@cloudflare/tanstack-ai",
  ],
});
