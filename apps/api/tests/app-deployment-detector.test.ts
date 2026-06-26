import { describe, expect, test } from "bun:test";

import {
  AppDeploymentDetectionError,
  detectAppDeploymentPlan,
} from "../src/modules/apps/application/app-deployment-detector";

function detect(files: Record<string, string>) {
  return detectAppDeploymentPlan({ files });
}

describe("app deployment detector", () => {
  test("detects a root static page without install or build", () => {
    expect(detect({ "index.html": "<main>Hello</main>" })).toMatchObject({
      buildCommand: null,
      installCommand: null,
      outputDir: ".",
      packageManager: "none",
      rootDir: ".",
      targetKind: "cloudflare_pages",
      targetMode: "static_assets",
    });
  });

  test("detects Vite static output", () => {
    expect(
      detect({
        "package.json": JSON.stringify({
          devDependencies: { vite: "^7.0.0" },
          scripts: { build: "vite build" },
        }),
        "pnpm-lock.yaml": "",
      }),
    ).toMatchObject({
      buildCommand: "pnpm run build",
      installCommand: "pnpm install --frozen-lockfile",
      outputDir: "dist",
      packageManager: "pnpm",
      targetKind: "cloudflare_pages",
    });
  });

  test("requires a build script for Vite static output", () => {
    expect(() =>
      detect({
        "index.html": "<main></main>",
        "package.json": JSON.stringify({
          devDependencies: { vite: "^7.0.0" },
        }),
        "pnpm-lock.yaml": "",
      }),
    ).toThrow(AppDeploymentDetectionError);
  });

  test("does not freeze install when packageManager has no lockfile", () => {
    expect(
      detect({
        "package.json": JSON.stringify({
          devDependencies: { vite: "^7.0.0" },
          packageManager: "pnpm@10.0.0",
          scripts: { build: "vite build" },
        }),
      }),
    ).toMatchObject({
      installCommand: "pnpm install",
      packageManager: "pnpm",
    });
  });

  test("requires explicit static export for Next.js", () => {
    expect(() =>
      detect({
        "package.json": JSON.stringify({
          dependencies: { next: "^16.0.0" },
          scripts: { build: "next build" },
        }),
      }),
    ).toThrow(AppDeploymentDetectionError);
  });

  test("detects Next.js static export", () => {
    expect(
      detect({
        "next.config.mjs": "export default { output: 'export' };",
        "package-lock.json": "{}",
        "package.json": JSON.stringify({
          dependencies: { next: "^16.0.0" },
          scripts: { build: "next build" },
        }),
      }),
    ).toMatchObject({
      buildCommand: "npm run build",
      installCommand: "npm ci",
      outputDir: "out",
      packageManager: "npm",
      targetKind: "cloudflare_pages",
    });
  });

  test("uses .mosoo.toml static override", () => {
    expect(
      detect({
        ".mosoo.toml": `
type = "static"
root = "site"

[build]
install = "bun install --frozen-lockfile"
command = "bun run build"
output = "public"

[routes]
fallback = "index.html"
`,
        "site/package.json": JSON.stringify({ scripts: { build: "vite build" } }),
      }),
    ).toMatchObject({
      buildCommand: "bun run build",
      installCommand: "bun install --frozen-lockfile",
      mosooConfigPath: ".mosoo.toml",
      outputDir: "public",
      routesFallback: "index.html",
      rootDir: "site",
      targetKind: "cloudflare_pages",
    });
  });

  test("uses .mosoo.toml worker override", () => {
    expect(
      detect({
        ".mosoo.toml": `
type = "worker"

[worker]
entry = "src/index.ts"
`,
      }),
    ).toMatchObject({
      mosooConfigPath: ".mosoo.toml",
      outputDir: null,
      rootDir: ".",
      targetKind: "cloudflare_worker",
      targetMode: "worker_module",
    });
  });

  test("rejects routes fallback for worker override", () => {
    expect(() =>
      detect({
        ".mosoo.toml": `
type = "worker"

[worker]
entry = "src/index.ts"

[routes]
fallback = "index.html"
`,
      }),
    ).toThrow(AppDeploymentDetectionError);
  });

  test("detects wrangler main as a Worker hint", () => {
    expect(
      detect({
        "package.json": JSON.stringify({
          dependencies: { hono: "^4.0.0" },
          scripts: { build: "tsc" },
        }),
        "wrangler.jsonc": '{ "main": "src/index.ts" }',
      }),
    ).toMatchObject({
      buildCommand: "npm run build",
      installCommand: "npm install",
      packageManager: "npm",
      targetKind: "cloudflare_worker",
      targetMode: "worker_module",
    });
  });

  test("continues reading Wrangler hints until it finds main", () => {
    expect(
      detect({
        "package.json": JSON.stringify({ scripts: { build: "tsc" } }),
        "wrangler.jsonc": '{ "main": "src/index.ts" }',
        "wrangler.toml": "name = ",
      }),
    ).toMatchObject({
      targetKind: "cloudflare_worker",
    });
  });

  test("rejects unsupported .mosoo.toml fields", () => {
    expect(() =>
      detect({
        ".mosoo.toml": `
type = "static"
account_id = "do-not-pass-through"
`,
      }),
    ).toThrow(AppDeploymentDetectionError);
  });

  test("rejects .mosoo.toml paths outside the repository", () => {
    expect(() =>
      detect({
        ".mosoo.toml": `
type = "worker"
root = "apps/../secret"

[worker]
entry = "src/index.ts"
`,
      }),
    ).toThrow(AppDeploymentDetectionError);
  });
});
