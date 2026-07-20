import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProcessSupervisor } from "../docker/process-supervisor";

const repositoryRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const entrypoint = await Bun.file(join(repositoryRoot, "docker/entrypoint.ts")).text();
const temporaryDirectories: string[] = [];

async function waitForOutput(
  process: Bun.Subprocess<"ignore", "pipe", "pipe">,
  expected: string,
): Promise<string> {
  const reader = process.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (!output.includes(expected)) {
    const next = await Promise.race([
      reader.read(),
      Bun.sleep(5_000).then(() => {
        throw new Error(`Timed out waiting for ${expected}. Output: ${output}`);
      }),
    ]);
    if (next.done) {
      const stderr = await new Response(process.stderr).text();
      throw new Error(`Harness exited before ${expected}. stderr: ${stderr}`);
    }
    output += decoder.decode(next.value, { stream: true });
  }
  return output;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("Docker entrypoint signal handling", () => {
  test("does not treat an internal sibling shutdown as an externally received signal", () => {
    const supervisor = createProcessSupervisor();

    supervisor.stop("SIGTERM");

    expect(supervisor.receivedSignal).toBeNull();
  });

  test("forwards SIGTERM to an active migration and exits within the grace period", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mosoo-entrypoint-signal-"));
    temporaryDirectories.push(directory);
    const markerPath = join(directory, "migration.signal");
    const harness = Bun.spawn(["bun", "scripts/fixtures/docker-entrypoint-signal-harness.ts"], {
      cwd: repositoryRoot,
      env: { ...process.env, MOSOO_SIGNAL_MARKER: markerPath },
      stderr: "pipe",
      stdout: "pipe",
    });

    try {
      await waitForOutput(harness, "HARNESS_READY\n");
      harness.kill("SIGTERM");
      const exitCode = await Promise.race([
        harness.exited,
        Bun.sleep(5_000).then(() => {
          throw new Error("Harness did not stop within 5 seconds.");
        }),
      ]);

      expect(exitCode).toBe(0);
      expect(await readFile(markerPath, "utf8")).toBe("SIGTERM\n");
    } finally {
      if (harness.exitCode === null) {
        harness.kill("SIGKILL");
        await harness.exited;
      }
    }
  });

  test("installs signal forwarding before starting migrations", () => {
    const installIndex = entrypoint.indexOf("installSignalHandlers()");
    const migrationIndex = entrypoint.indexOf("await runMigration(");

    expect(installIndex).toBeGreaterThan(-1);
    expect(migrationIndex).toBeGreaterThan(installIndex);
  });
});
