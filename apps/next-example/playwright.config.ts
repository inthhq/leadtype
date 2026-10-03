import { defineConfig } from "@playwright/test";

const PORT = 4321;
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

// Request-only smoke gate: asserts the built server's HTML + agent surface.
// No browser project, so no Playwright browser binaries are required.
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts/,
  use: { baseURL },
  webServer: {
    command: `bun run build && bunx next start --port ${PORT}`,
    url: baseURL,
    timeout: 240_000,
    reuseExistingServer: !isCI,
  },
});
