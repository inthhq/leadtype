import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const appRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      react: join(appRoot, "node_modules", "react"),
      "react-dom": join(appRoot, "node_modules", "react-dom"),
      "react/jsx-dev-runtime": join(
        appRoot,
        "node_modules",
        "react",
        "jsx-dev-runtime.js"
      ),
      "react/jsx-runtime": join(
        appRoot,
        "node_modules",
        "react",
        "jsx-runtime.js"
      ),
    },
  },
  server: {
    allowedHosts: [".localhost"],
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
  preview: {
    allowedHosts: [".localhost"],
  },
  plugins: [viteTsConfigPaths({ projects: ["./tsconfig.json"] }), viteReact()],
});
