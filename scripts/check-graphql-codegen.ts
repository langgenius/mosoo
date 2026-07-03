import { readFile } from "node:fs/promises";
import { relative } from "node:path";

import { generate } from "@graphql-codegen/cli";

import config, { applyWriteHooks } from "../config/graphql-codegen.ts";

interface GeneratedFile {
  content?: string;
  filename: string;
}

function isGeneratedFile(value: unknown): value is GeneratedFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const content = record["content"];

  return (
    typeof record["filename"] === "string" && (content === undefined || typeof content === "string")
  );
}

function normalizePath(path: string): string {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

function getErrorCode(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  return (error as Record<string, unknown>)["code"];
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return null;
    }

    throw error;
  }
}

const output = (await generate({ ...config, cwd: process.cwd() }, false)) as unknown;

if (!Array.isArray(output)) {
  throw new TypeError("GraphQL codegen did not return generated files.");
}

const staleFiles: string[] = [];

for (const item of output) {
  if (!isGeneratedFile(item)) {
    throw new TypeError("GraphQL codegen returned an invalid generated file.");
  }

  const expected = applyWriteHooks(item.filename, item.content ?? "");
  const actual = await readText(item.filename);

  if (actual !== expected) {
    staleFiles.push(normalizePath(item.filename));
  }
}

if (staleFiles.length > 0) {
  console.error("GraphQL generated outputs are stale. Run `just graphql-codegen`.");

  for (const file of staleFiles) {
    console.error(`- ${file}`);
  }

  process.exitCode = 1;
}
