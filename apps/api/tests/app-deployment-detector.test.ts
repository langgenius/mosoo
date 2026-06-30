import { describe, expect, test } from "bun:test";

import {
  AppDeploymentDetectionError,
  detectAppDeploymentPlan,
} from "../src/modules/apps/application/app-deployment-detector";

const RESOURCE_NAME = "app-01j00000000000000000000054";

function detect(files: Record<string, string>) {
  return detectAppDeploymentPlan({ files }, { resourceName: RESOURCE_NAME });
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

  test("uses the caller-provided Cloudflare resource name", () => {
    expect(detect({ "index.html": "<main>Hello</main>" }).generatedWranglerConfig).toContain(
      `name = "${RESOURCE_NAME}"`,
    );
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
entry = "src/index.js"
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

  test("keeps the legacy flat worker override taking precedence over wrangler main", () => {
    expect(
      detect({
        ".mosoo.toml": `
type = "worker"

[worker]
entry = "src/index.js"
`,
        "wrangler.toml": 'main = "src/other.js"\n',
      }),
    ).toMatchObject({
      mosooConfigPath: ".mosoo.toml",
      targetKind: "cloudflare_worker",
      targetMode: "worker_module",
      workerEntry: "src/index.js",
    });
  });

  test("parses .mosoo.toml [[agents]] bindings", () => {
    expect(
      detect({
        ".mosoo.toml": `
type = "worker"

[worker]
entry = "src/index.js"

[[agents]]
name = "roadmap"
expose = "public_thread"
env = "ROADMAP_THREAD_URL"

[[agents]]
name = "triage"
expose = "public_thread"
env = "TRIAGE_THREAD_URL"
`,
      }).agentBindings,
    ).toEqual([
      { env: "ROADMAP_THREAD_URL", expose: "public_thread", name: "roadmap" },
      { env: "TRIAGE_THREAD_URL", expose: "public_thread", name: "triage" },
    ]);
  });

  test("parses the schema-v1 product manifest into a worker target", () => {
    const plan = detect({
      ".mosoo.toml": `
schema = 1
name = "roadmap-board"

[deploy]
adapter = "cloudflare-workers"
wrangler = "wrangler.toml"

[[agents]]
name = "roadmap"
expose = "public_thread"
env = "MOSOO_AGENT_ROADMAP_URL"
`,
      "wrangler.toml": 'name = "roadmap-board"\nmain = "src/index.js"\n',
    });

    expect(plan).toMatchObject({
      mosooConfigPath: ".mosoo.toml",
      outputDir: null,
      rootDir: ".",
      targetKind: "cloudflare_worker",
      targetMode: "worker_module",
      workerEntry: "src/index.js",
    });
    expect(plan.agentBindings).toEqual([
      { env: "MOSOO_AGENT_ROADMAP_URL", expose: "public_thread", name: "roadmap" },
    ]);
  });

  test("rejects duplicate agent names", () => {
    expect(() =>
      detect({
        ".mosoo.toml": `
schema = 1

[deploy]
adapter = "cloudflare-workers"
wrangler = "wrangler.toml"

[[agents]]
name = "roadmap"
expose = "public_thread"
env = "ROADMAP_THREAD_URL"

[[agents]]
name = "roadmap"
expose = "public_thread"
env = "TRIAGE_THREAD_URL"
`,
        "wrangler.toml": 'main = "src/index.js"\n',
      }),
    ).toThrow(AppDeploymentDetectionError);
  });

  test("rejects duplicate agent env vars", () => {
    expect(() =>
      detect({
        ".mosoo.toml": `
schema = 1

[deploy]
adapter = "cloudflare-workers"
wrangler = "wrangler.toml"

[[agents]]
name = "roadmap"
expose = "public_thread"
env = "SHARED_THREAD_URL"

[[agents]]
name = "triage"
expose = "public_thread"
env = "SHARED_THREAD_URL"
`,
        "wrangler.toml": 'main = "src/index.js"\n',
      }),
    ).toThrow(AppDeploymentDetectionError);
  });

  test("rejects an agent binding that is not public_thread", () => {
    expect(() =>
      detect({
        ".mosoo.toml": `
type = "worker"

[worker]
entry = "src/index.js"

[[agents]]
name = "roadmap"
expose = "private"
env = "ROADMAP_THREAD_URL"
`,
      }),
    ).toThrow(AppDeploymentDetectionError);
  });

  test("rejects [[agents]] on a static deployment", () => {
    expect(() =>
      detect({
        ".mosoo.toml": `
type = "static"

[build]
output = "dist"

[[agents]]
name = "roadmap"
expose = "public_thread"
env = "ROADMAP_THREAD_URL"
`,
      }),
    ).toThrow(AppDeploymentDetectionError);
  });

  test("repository-shape detection yields no agent bindings", () => {
    expect(detect({ "index.html": "<main>Hello</main>" }).agentBindings).toEqual([]);
  });

  test("rejects TypeScript worker entry in the first cut", () => {
    expect(() =>
      detect({
        ".mosoo.toml": `
type = "worker"

[worker]
entry = "src/index.ts"
`,
      }),
    ).toThrow(AppDeploymentDetectionError);
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
        "wrangler.jsonc": '{ "main": "src/index.js" }',
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
        "wrangler.jsonc": '{ "main": "src/index.js" }',
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
