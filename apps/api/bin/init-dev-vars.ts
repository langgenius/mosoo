#!/usr/bin/env bun
import type { BunRuntime } from "../../../config/bun-script-types";

declare const Bun: BunRuntime;

const scriptDir = decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/\/$/u, "");

interface DevVarSpec {
  readonly key: string;
  readonly required: boolean;
}

interface ParsedDevVarLine {
  readonly key: string;
  readonly rawValue: string;
}

const devVarsPath = `${scriptDir}/../.dev.vars`;
const devVarsRepoPath = "apps/api/.dev.vars";

const devVarSpecs: readonly DevVarSpec[] = [
  { key: "VAULT_ROOT_SECRET", required: true },
  { key: "BETTER_AUTH_SECRET", required: true },
  { key: "RUNTIME_ACTION_TOKEN_SECRET", required: true },
  { key: "GOOGLE_OAUTH_CLIENT_ID", required: false },
  { key: "GOOGLE_OAUTH_CLIENT_SECRET", required: false },
  { key: "R2_ACCESS_KEY_ID", required: false },
  { key: "R2_SECRET_ACCESS_KEY", required: false },
  { key: "CLOUDFLARE_ACCOUNT_ID", required: false },
  { key: "SKILLS_SH_API_TOKEN", required: false },
];

function createSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function parseDevVarLine(line: string): ParsedDevVarLine | null {
  const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/u.exec(line);

  if (match === null) {
    return null;
  }

  const [, key, rawValue] = match;

  if (key === undefined || rawValue === undefined) {
    return null;
  }

  return { key, rawValue };
}

function formatDevVarLine(spec: DevVarSpec): string {
  const value = spec.required ? createSecret() : "";
  return `${spec.key}=${value}`;
}

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

function createDevVarsContent(): string {
  return `${devVarSpecs.map(formatDevVarLine).join("\n")}\n`;
}

function updateExistingContent(content: string): {
  readonly changedKeys: readonly string[];
  readonly content: string;
} {
  const lines = content.split(/\r?\n/u);
  const presentKeys = new Set<string>();
  const changedKeys = new Set<string>();

  const nextLines = lines.map((line) => {
    const parsed = parseDevVarLine(line);

    if (parsed === null) {
      return line;
    }

    presentKeys.add(parsed.key);

    const spec = devVarSpecs.find((candidate) => candidate.key === parsed.key);
    if (spec === undefined || !spec.required || parsed.rawValue.trim().length > 0) {
      return line;
    }

    changedKeys.add(spec.key);
    return formatDevVarLine(spec);
  });

  for (const spec of devVarSpecs) {
    if (!presentKeys.has(spec.key)) {
      changedKeys.add(spec.key);
      nextLines.push(formatDevVarLine(spec));
    }
  }

  while (nextLines.at(-1) === "") {
    nextLines.pop();
  }

  return {
    changedKeys: [...changedKeys].toSorted(),
    content: `${nextLines.join("\n")}\n`,
  };
}

if (!(await Bun.file(devVarsPath).exists())) {
  await Bun.write(devVarsPath, createDevVarsContent());
  writeStdout(`Created ${devVarsRepoPath}.`);
  writeStdout("Generated local secrets and left optional provider credentials empty.");
  process.exit(0);
}

const updated = updateExistingContent(await Bun.file(devVarsPath).text());

if (updated.changedKeys.length === 0) {
  writeStdout(`${devVarsRepoPath} already has the required local env vars.`);
  process.exit(0);
}

await Bun.write(devVarsPath, updated.content);
writeStdout(`Updated ${devVarsRepoPath}: ${updated.changedKeys.join(", ")}.`);
