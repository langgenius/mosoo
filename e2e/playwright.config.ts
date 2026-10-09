import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const envFile = `${repoRoot}.env`;

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

// Proxy env vars give loopback no implicit bypass, so the webServer probe of 127.0.0.1 would go through the proxy.
const loopbackBypass = "localhost,127.0.0.1,::1";
process.env["NO_PROXY"] = process.env["NO_PROXY"]?.trim() || loopbackBypass;
process.env["no_proxy"] = process.env["no_proxy"]?.trim() || loopbackBypass;

const webPort = process.env["WEB_DEV_PORT"]?.trim() || "5173";
const baseURL = process.env["MOSOO_E2E_BASE_URL"]?.trim() || `http://127.0.0.1:${webPort}`;

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: "list",
  testDir: "cases",
  timeout: 5 * 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
  },
  webServer: {
    command: "node_modules/.bin/vp run --filter @mosoo/web dev",
    cwd: repoRoot,
    reuseExistingServer: true,
    timeout: 180_000,
    url: baseURL,
  },
  workers: 1,
});
