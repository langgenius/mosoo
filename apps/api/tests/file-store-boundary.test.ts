import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

function readTypeScriptFiles(directory: URL): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);

    if (entry.isDirectory()) {
      files.push(...readTypeScriptFiles(entryUrl));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push({
        path: entryUrl.pathname,
        text: readFileSync(entryUrl, "utf8"),
      });
    }
  }

  return files;
}

describe("Files application boundary", () => {
  test("keeps agent package file-record admission behind FileStore", () => {
    const agentApplicationFiles = readTypeScriptFiles(
      new URL("../src/modules/agents/application/", import.meta.url),
    );
    const offenders = agentApplicationFiles
      .filter((file) => /\bfileRecordsTable\b/.test(file.text))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});
