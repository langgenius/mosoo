import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  buildRuntimeE2EScoreboard,
  renderRuntimeE2EScoreboardMarkdown,
} from "../lib/runtime-e2e-scoreboard";

export async function runRuntimeE2EScoreboard(
  browserPath: string,
  providerDirectPath: string,
  crossoverPath: string,
  outputPath?: string,
  options: {
    readonly baselineCommit?: string;
    readonly candidateCommit?: string;
    readonly expectedHarnessRevision?: string;
    readonly generatedAt?: string;
  } = {},
): Promise<void> {
  const [browserDocument, providerDirectDocument, crossoverDocument] = await Promise.all(
    [browserPath, providerDirectPath, crossoverPath].map(async (path) =>
      JSON.parse(await readFile(path, "utf8")),
    ),
  );
  const scoreboard = buildRuntimeE2EScoreboard({
    artifactPaths: {
      browser: resolve(browserPath),
      crossover: resolve(crossoverPath),
      providerDirect: resolve(providerDirectPath),
    },
    baselineCommit:
      options.baselineCommit ?? process.env["MOSOO_PERF_BASELINE_COMMIT"]?.trim() ?? "",
    browserDocument,
    candidateCommit: options.candidateCommit ?? process.env["MOSOO_E2E_GIT_COMMIT"]?.trim() ?? "",
    crossoverDocument,
    expectedHarnessRevision:
      options.expectedHarnessRevision ??
      process.env["MOSOO_PERF_EXPECTED_HARNESS_REVISION"]?.trim() ??
      "",
    ...(options.generatedAt === undefined ? {} : { generatedAt: options.generatedAt }),
    providerDirectDocument,
  });
  const markdown = renderRuntimeE2EScoreboardMarkdown(scoreboard);

  if (outputPath === undefined) {
    process.stdout.write(markdown);
    return;
  }

  const markdownPath = outputPath.endsWith(".json")
    ? outputPath.replace(/\.json$/u, ".md")
    : `${outputPath}.md`;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(scoreboard, null, 2)}\n`, { mode: 0o600 });
  await writeFile(markdownPath, markdown, { mode: 0o600 });
  await Promise.all([chmod(outputPath, 0o600), chmod(markdownPath, 0o600)]);
}

if (import.meta.main) {
  const [browserPath, providerDirectPath, crossoverPath, outputPath] = Bun.argv.slice(2);

  if (
    browserPath === undefined ||
    providerDirectPath === undefined ||
    crossoverPath === undefined
  ) {
    throw new Error(
      "Usage: bun e2e/bin/runtime-e2e-scoreboard.ts <browser.json> <provider-direct.json> <cold-start-v12.json> [scoreboard.json]",
    );
  }

  await runRuntimeE2EScoreboard(browserPath, providerDirectPath, crossoverPath, outputPath);
}
