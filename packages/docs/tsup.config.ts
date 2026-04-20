import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "components/index": "src/components/index.ts",
    "remark/index": "src/remark/index.ts",
    "convert/index": "src/convert/index.ts",
    "llm/index": "src/llm/index.ts",
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
  ],
});
