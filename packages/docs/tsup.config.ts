import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "components/index": "src/components/index.ts",
    "remark/index": "src/remark/index.ts",
    "convert/index": "src/convert/index.ts",
    "llm/index": "src/llm/index.ts",
    "search/index": "src/search/index.ts",
    "search/node-index": "src/search/node-index.ts",
    "search/ai-index": "src/search/ai-index.ts",
    "search/bash-index": "src/search/bash-index.ts",
    "lint/index": "src/lint/index.ts",
    "lint/cli": "src/lint/cli.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  splitting: false,
  treeshake: true,
  onSuccess: async () => {
    const { chmod, readFile, writeFile } = await import("node:fs/promises");
    const cli = "dist/lint/cli.js";
    const components = "dist/components/index.js";
    const contents = await readFile(cli, "utf8");
    if (!contents.startsWith("#!")) {
      await writeFile(cli, `#!/usr/bin/env node\n${contents}`);
    }
    const componentContents = await readFile(components, "utf8");
    // Consumers import the bundled root entry in RSC-aware apps, so the built
    // barrel needs a client boundary even though only some source files use
    // hooks directly.
    if (!componentContents.startsWith('"use client";')) {
      await writeFile(components, `"use client";\n${componentContents}`);
    }
    await chmod(cli, 0o755);
  },
  external: [
    "react",
    "react-dom",
    "next",
    "typescript",
    "fs",
    "path",
    "node:fs",
    "node:path",
    "node:fs/promises",
    "ai",
    "bash-tool",
    "just-bash",
  ],
});
