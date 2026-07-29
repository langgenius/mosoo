import { chmod, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { computeHarnessRevision } from "./cold-start-ab";

const HARNESS_FILES = [
  "e2e/bin/cold-start-ab.ts",
  "e2e/bin/perf-stage-hook.ts",
  "e2e/env.ts",
  "e2e/lib/cold-start-benchmark.ts",
  "e2e/lib/cold-start-experiment.ts",
  "e2e/lib/perf-stage-control.ts",
] as const;

export interface FrozenPerformanceHarness {
  readonly hookPath: string;
  readonly revision: string;
  readonly root: string;
  readonly runnerPath: string;
}

async function createDestinationRoot(configuredRoot?: string): Promise<string> {
  if (configuredRoot === undefined || configuredRoot.trim().length === 0) {
    return mkdtemp(join(tmpdir(), "mosoo-perf-golden-v12-"));
  }

  const root = resolve(configuredRoot);
  await mkdir(root);
  return root;
}

export async function freezePerformanceHarness(
  configuredRoot?: string,
): Promise<FrozenPerformanceHarness> {
  const sourceRoot = resolve(import.meta.dir, "../..");
  const root = await createDestinationRoot(configuredRoot);

  for (const relativePath of HARNESS_FILES) {
    const destinationPath = join(root, relativePath);
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(join(sourceRoot, relativePath), destinationPath);
    await chmod(destinationPath, 0o444);
  }

  const hookPath = join(root, "e2e/bin/perf-stage-hook.ts");
  const revision = await computeHarnessRevision(hookPath);
  const revisionPath = join(root, "PERF_HARNESS_REVISION");
  await writeFile(revisionPath, `${revision}\n`, { mode: 0o444 });

  for (const relativeDirectory of ["e2e/bin", "e2e/lib", "e2e", "."] as const) {
    await chmod(join(root, relativeDirectory), 0o555);
  }

  return {
    hookPath,
    revision,
    root,
    runnerPath: join(root, "e2e/bin/cold-start-ab.ts"),
  };
}

if (import.meta.main) {
  const frozen = await freezePerformanceHarness(process.env["MOSOO_PERF_GOLDEN_ROOT"]);
  console.log(JSON.stringify(frozen));
}
