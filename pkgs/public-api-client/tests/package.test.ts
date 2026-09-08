import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const process = Bun.spawn([command, ...args], {
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${stderr}${stdout}`);
  }

  return stdout.trim();
}

describe("published package", () => {
  test("installs one tarball in clean Node.js and Cloudflare Worker fixtures", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "mosoo-sdk-package-"));

    try {
      const packDirectory = join(temporaryRoot, "pack");
      const fixtureDirectory = join(temporaryRoot, "fixture");
      await mkdir(packDirectory);
      await mkdir(fixtureDirectory);

      await run("bun", ["run", "build"], PACKAGE_ROOT);
      await run(
        "bun",
        ["pm", "pack", "--destination", packDirectory, "--ignore-scripts", "--quiet"],
        PACKAGE_ROOT,
      );

      const tarballName = (await readdir(packDirectory)).find((name) => name.endsWith(".tgz"));
      expect(tarballName).toBeDefined();

      const tarballPath = join(packDirectory, tarballName!);
      await run(
        "npm",
        [
          "install",
          "--prefix",
          fixtureDirectory,
          tarballPath,
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ],
        fixtureDirectory,
      );

      const installedRoot = join(fixtureDirectory, "node_modules", "@mosoo", "sdk");
      const [declarations, javascript, license, manifestText] = await Promise.all([
        readFile(join(installedRoot, "dist", "index.d.ts"), "utf8"),
        readFile(join(installedRoot, "dist", "index.js"), "utf8"),
        readFile(join(installedRoot, "LICENSE"), "utf8"),
        readFile(join(installedRoot, "package.json"), "utf8"),
      ]);
      const manifest = JSON.parse(manifestText) as {
        dependencies?: Record<string, string>;
        name: string;
        private: boolean;
        version: string;
      };

      expect(manifest).toMatchObject({
        name: "@mosoo/sdk",
        private: false,
        version: "0.1.0-beta.0",
      });
      expect(manifest.dependencies).toBeUndefined();
      expect(javascript).not.toContain("@mosoo/");
      expect(javascript).not.toContain('from "node:');
      expect(declarations).not.toContain("@mosoo/");
      expect(license).toContain("Apache License");

      await run(
        "node",
        [
          "--input-type=module",
          "--eval",
          [
            'import { Mosoo, MosooPublicThreadClient } from "@mosoo/sdk";',
            "let requestedUrl = null;",
            "const client = new Mosoo({",
            '  token: "mst_test",',
            "  fetch: async (input) => {",
            "    requestedUrl = String(input);",
            "    return Response.json({ events: [], truncated: false });",
            "  },",
            "});",
            'if (!(client instanceof MosooPublicThreadClient)) throw new Error("Bad Mosoo alias.");',
            'await client.listEvents({ threadId: "thread-1" });',
            'if (requestedUrl !== "https://cloud.mosoo.ai/api/v1/threads/thread-1/events") {',
            "  throw new Error(`Unexpected URL: ${requestedUrl}`);",
            "}",
          ].join("\n"),
        ],
        fixtureDirectory,
      );

      const typecheckPath = join(fixtureDirectory, "typecheck.ts");
      const tsconfigPath = join(fixtureDirectory, "tsconfig.json");
      await Bun.write(
        typecheckPath,
        [
          'import { Mosoo, type PublicThreadRunSummary } from "@mosoo/sdk";',
          'const client = new Mosoo({ token: "mst_test" });',
          "const run: PublicThreadRunSummary | null = null;",
          "void client;",
          "void run;",
        ].join("\n"),
      );
      await Bun.write(
        tsconfigPath,
        JSON.stringify({
          compilerOptions: {
            lib: ["ES2022", "DOM"],
            module: "NodeNext",
            moduleResolution: "NodeNext",
            noEmit: true,
            strict: true,
            target: "ES2022",
          },
          include: ["typecheck.ts"],
        }),
      );
      await run(
        resolve(PACKAGE_ROOT, "node_modules/.bin/tsc"),
        ["-p", tsconfigPath],
        fixtureDirectory,
      );

      const workerFixtureDirectory = join(fixtureDirectory, "worker");
      await cp(
        join(PACKAGE_ROOT, "tests", "fixtures", "cloudflare-worker"),
        workerFixtureDirectory,
        { recursive: true },
      );
      const workerConfigPath = join(workerFixtureDirectory, "wrangler.jsonc");
      await run(
        resolve(PACKAGE_ROOT, "node_modules/.bin/wrangler"),
        ["types", "worker-configuration.d.ts", "--config", workerConfigPath],
        workerFixtureDirectory,
      );
      await Bun.write(
        join(workerFixtureDirectory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            lib: ["ES2022"],
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            strict: true,
          },
          include: ["worker-configuration.d.ts", "src/**/*.ts"],
        }),
      );
      await run(
        resolve(PACKAGE_ROOT, "node_modules/.bin/tsc"),
        ["-p", join(workerFixtureDirectory, "tsconfig.json")],
        workerFixtureDirectory,
      );
      await run(
        "node",
        [resolve(PACKAGE_ROOT, "tests", "worker-runtime-smoke.mjs"), workerConfigPath],
        fixtureDirectory,
      );
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }, 60_000);
});
