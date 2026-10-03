import { defineConfig } from "@playwright/test";

const PORT = 4323;
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

// Request-only smoke gate against the built Nitro server (no browser binary).
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts/,
  use: { baseURL },
  webServer: {
    command: `bun run build && PORT=${PORT} node .output/server/index.mjs`,
    url: baseURL,
    timeout: 240_000,
    reuseExistingServer: !isCI,
  },
});
