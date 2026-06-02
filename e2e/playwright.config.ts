import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const webPort = process.env["WEB_DEV_PORT"]?.trim() || "5173";
const baseURL = process.env["MOSOO_E2E_BASE_URL"]?.trim() || `http://localhost:${webPort}`;
const defaultWebServerCommand = `${repoRoot}/node_modules/.bin/vp run dev`;
const webServerCommand =
  process.env["MOSOO_E2E_WEB_SERVER_COMMAND"]?.trim() || defaultWebServerCommand;

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env["CI"]),
  fullyParallel: false,
  reporter: process.env["CI"] ? [["list"], ["html", { open: "never" }]] : "list",
  testDir: ".",
  timeout: 5 * 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: {
    command: webServerCommand,
    cwd: repoRoot,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    url: baseURL,
  },
  workers: 1,
});
