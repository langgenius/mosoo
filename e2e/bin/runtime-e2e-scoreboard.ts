import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  renderRuntimeE2EScoreboardMarkdown,
  runtimeE2ESamplesFromColdStartDocument,
  summarizeRuntimeE2EScoreboard,
} from "../lib/runtime-e2e-scoreboard";

export async function runRuntimeE2EScoreboard(
  inputPath: string,
  outputPath?: string,
): Promise<void> {
  const document: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  const scoreboard = summarizeRuntimeE2EScoreboard(
    runtimeE2ESamplesFromColdStartDocument(document),
  );
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
}

if (import.meta.main) {
  const [inputPath, outputPath] = Bun.argv.slice(2);

  if (inputPath === undefined) {
    throw new Error(
      "Usage: bun e2e/bin/runtime-e2e-scoreboard.ts <cold-start-v12.json> [scoreboard.json]",
    );
  }

  await runRuntimeE2EScoreboard(inputPath, outputPath);
}
