import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const HTTPS_PROTOCOL = "https://";
const HTTP_PROTOCOL = "http://";

function getDocsSmokeBaseUrl(): string {
  const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const portlessUrl = execFileSync("portless", ["get", "docs-smoke"], {
    encoding: "utf8",
  }).trim();

  return portlessUrl.startsWith(HTTPS_PROTOCOL)
    ? `${HTTP_PROTOCOL}${portlessUrl.slice(HTTPS_PROTOCOL.length)}`
    : portlessUrl;
}

const docsSmokeBaseUrl = getDocsSmokeBaseUrl();

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  use: {
    baseURL: docsSmokeBaseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run dev",
    url: docsSmokeBaseUrl,
    reuseExistingServer: !isCI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
