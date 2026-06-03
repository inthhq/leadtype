import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const DEFAULT_BASE_URL = "https://tanstack.localhost";

function getTanstackBaseUrl(): string {
  const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  let portlessUrl: string;
  try {
    portlessUrl = execFileSync("portless", ["get", "tanstack"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PORTLESS_PORT: "443",
        PORTLESS_HTTPS: "1",
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 5000,
    }).trim();
  } catch {
    process.stderr.write(
      `Unable to resolve tanstack through portless. Falling back to ${DEFAULT_BASE_URL}. Set PLAYWRIGHT_BASE_URL to override this value.\n`
    );
    return DEFAULT_BASE_URL;
  }

  return portlessUrl;
}

const tanstackBaseUrl = getTanstackBaseUrl();

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  use: {
    baseURL: tanstackBaseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run dev",
    url: tanstackBaseUrl,
    reuseExistingServer: !isCI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
