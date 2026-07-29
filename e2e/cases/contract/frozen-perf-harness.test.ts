import { afterEach, describe, expect, test } from "bun:test";
import { chmod, readFile, rm, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { freezePerformanceHarness } from "../../bin/freeze-perf-harness";

const frozenRoots: string[] = [];

afterEach(async () => {
  for (const root of frozenRoots.splice(0)) {
    await chmod(root, 0o755);
    await chmod(`${root}/e2e`, 0o755);
    await chmod(`${root}/e2e/bin`, 0o755);
    await chmod(`${root}/e2e/lib`, 0o755);
    await rm(root, { force: true, recursive: true });
  }
});

describe("frozen performance harness", () => {
  test("copies the complete judge, pins its hash, and removes write permission", async () => {
    const frozen = await freezePerformanceHarness();
    frozenRoots.push(frozen.root);

    const frozenRunner = (await import(
      `${pathToFileURL(frozen.runnerPath).href}?test=${Date.now()}`
    )) as {
      computeHarnessRevision(hookPath: string): Promise<string>;
    };
    const runnerMode = (await stat(frozen.runnerPath)).mode;
    const rootMode = (await stat(frozen.root)).mode;

    expect(await readFile(`${frozen.root}/PERF_HARNESS_REVISION`, "utf8")).toBe(
      `${frozen.revision}\n`,
    );
    expect(await frozenRunner.computeHarnessRevision(frozen.hookPath)).toBe(frozen.revision);
    expect(frozen.root).toContain("mosoo-perf-golden-v12-");
    expect(runnerMode & 0o222).toBe(0);
    expect(rootMode & 0o222).toBe(0);
  });
});
