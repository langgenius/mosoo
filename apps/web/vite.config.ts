import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { UserConfig } from "vite-plus";

import { createSharedLintConfig, sharedFmtConfig } from "../../config/vite-plus.shared.ts";

const sourceRoot = fileURLToPath(new URL("src", import.meta.url));
const webDevPort = Number(process.env["WEB_DEV_PORT"] ?? "5173");
// API proxy target auto-pairs with WRANGLER_DEV_PORT so that setting only
// The port pair (WEB_DEV_PORT + WRANGLER_DEV_PORT) per checkout is enough —
// No need to also set API_PROXY_TARGET. Explicit API_PROXY_TARGET still wins
// For the rare case of pointing vite at a remote api.
const wranglerDevPort = process.env["WRANGLER_DEV_PORT"]?.trim() ?? "8787";
const apiProxyTarget = process.env["API_PROXY_TARGET"] ?? `http://localhost:${wranglerDevPort}`;

const toolConfig = {
  fmt: sharedFmtConfig,
  lint: createSharedLintConfig({
    env: {
      browser: true,
      builtin: true,
      serviceworker: true,
      "shared-node-browser": true,
      vitest: true,
      worker: true,
    },
    ignorePatterns: ["dist/**", "src/gql/**"],
  }),
} satisfies Pick<UserConfig, "fmt" | "lint">;

const webConfig = {
  ...toolConfig,
  build: {
    rollupOptions: {
      output: {
        // Pull the stable framework runtime (React, React DOM, the router, and
        // TanStack Query) out of the app entry chunk into its own long-lived
        // vendor chunk. These packages change only on dependency bumps, so a
        // returning visitor keeps them in cache across every app deploy instead
        // of re-downloading ~150 KB of unchanged framework code baked into the
        // entry. The framework and its peers share one chunk so React stays a
        // single instance and there is no cross-chunk import waterfall.
        advancedChunks: {
          groups: [
            {
              name: "framework",
              priority: 10,
              test: /[\\/]node_modules[\\/](\.bun[\\/])?(react|react-dom|scheduler|react-router|react-router-dom|@tanstack[\\/]react-query|@tanstack[\\/]query-core)[@\\/]/,
            },
          ],
        },
      },
    },
  },
  plugins: [...react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(sourceRoot),
    },
  },
  server: {
    host: "0.0.0.0",
    port: webDevPort,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        ws: true,
      },
    },
    strictPort: true,
  },
  test: {
    environment: "jsdom",
  },
};

export default webConfig;
