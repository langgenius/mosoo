import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { generate } from "@graphql-codegen/cli";

import config, { ensureTrailingNewline } from "../config/graphql-codegen.ts";

const output = (await generate({ ...config, cwd: process.cwd() }, false)) as {
  content: string;
  filename: string;
}[];

const staleFiles: string[] = [];

for (const item of output) {
  const expected = ensureTrailingNewline(item.filename, item.content);
  const actual = await readFile(item.filename, "utf8").catch(() => null);

  if (actual !== expected) {
    staleFiles.push(relative(process.cwd(), item.filename).replaceAll("\\", "/"));
  }
}

if (staleFiles.length > 0) {
  console.error("GraphQL generated outputs are stale. Run `just graphql-codegen`.");

  for (const file of staleFiles) {
    console.error(`- ${file}`);
  }

  process.exitCode = 1;
}
