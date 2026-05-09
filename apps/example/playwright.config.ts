import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const HTTPS_PROTOCOL = "https://";
const HTTP_PROTOCOL = "http://";
const PORTLESS_HTTP_PORT = "1355";
const DEFAULT_BASE_URL = "http://localhost:3000";

function getExampleBaseUrl(): string {
  const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  let portlessUrl: string;
  try {
    portlessUrl = execFileSync("portless", ["get", "example"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PORTLESS_HTTPS: "0",
        PORTLESS_PORT: PORTLESS_HTTP_PORT,
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5000,
    }).trim();
  } catch {
    process.stderr.write(
      `Unable to resolve example through portless. Falling back to ${DEFAULT_BASE_URL}. Set PLAYWRIGHT_BASE_URL to override this value.\n`
    );
    return DEFAULT_BASE_URL;
  }

  // Playwright drives the local Vite server over HTTP; portlessUrl can be HTTPS
  // in the shell, which makes browser tests fail on local TLS.
  return portlessUrl.startsWith(HTTPS_PROTOCOL)
    ? `${HTTP_PROTOCOL}${portlessUrl.slice(HTTPS_PROTOCOL.length)}`
    : portlessUrl;
}

const exampleBaseUrl = getExampleBaseUrl();

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  use: {
    baseURL: exampleBaseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run dev",
    url: exampleBaseUrl,
    reuseExistingServer: !isCI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
