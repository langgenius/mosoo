import { describe, expect, test } from "bun:test";

import {
  admitAgentPackageArchiveEntries,
  collectEnvironmentSidecarIssues,
  collectMcpManifestCatalogIssues,
  collectMcpSidecarIssues,
  findForbiddenEnvironmentSidecarFieldPath,
  findForbiddenMcpSecretFieldPath,
} from "@mosoo/agent-package";
import type { AgentPackageArchiveEntryCandidate } from "@mosoo/agent-package";
import { NATIVE_REPO_FIXTURE_CASES } from "@mosoo/contracts/native-repo-fixtures";
import type { NativeRepoFixtureCase } from "@mosoo/contracts/native-repo-fixtures";

const AGENT_DIR_PREFIX = ".agent/";
const textEncoder = new TextEncoder();

function findFixtureCase(name: string): NativeRepoFixtureCase {
  const fixtureCase = NATIVE_REPO_FIXTURE_CASES.find((entry) => entry.name === name);

  if (fixtureCase === undefined) {
    throw new Error(`Fixture case ${name} is missing.`);
  }

  return fixtureCase;
}

function toArchiveEntries(files: Readonly<Record<string, string>>): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};

  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(AGENT_DIR_PREFIX)) {
      continue;
    }

    entries[path.slice(AGENT_DIR_PREFIX.length)] = textEncoder.encode(content);
  }

  return entries;
}

function readPrimaryManifestJson(files: Readonly<Record<string, string>>): string {
  const manifestJson = files[".agent/manifest.json"];

  if (manifestJson === undefined) {
    throw new Error("Fixture is missing .agent/manifest.json.");
  }

  return manifestJson;
}

describe("native deploy sidecar validator reuse", () => {
  test("green sidecar fixture passes both sidecar collectors", () => {
    const fixtureCase = findFixtureCase("valid-single-agent-with-sidecar-setup");
    const manifestJson = readPrimaryManifestJson(fixtureCase.files);
    const entries = toArchiveEntries(fixtureCase.files);

    expect(collectMcpSidecarIssues(manifestJson, entries)).toEqual([]);
    expect(collectEnvironmentSidecarIssues(manifestJson, entries)).toEqual([]);
  });

  test("plaintext mcp secret fixture is rejected by the mcp sidecar collector", () => {
    const fixtureCase = findFixtureCase("red-mcp-plaintext-secret");
    const manifestJson = readPrimaryManifestJson(fixtureCase.files);
    const entries = toArchiveEntries(fixtureCase.files);
    const issues = collectMcpSidecarIssues(manifestJson, entries);

    expect(issues.map((issue) => issue.code)).toEqual(["package.mcp.secret_forbidden"]);
  });

  test("plaintext environment secret fixture is rejected by the environment collector", () => {
    const fixtureCase = findFixtureCase("red-environment-plaintext-secret");
    const manifestJson = readPrimaryManifestJson(fixtureCase.files);
    const entries = toArchiveEntries(fixtureCase.files);
    const issues = collectEnvironmentSidecarIssues(manifestJson, entries);

    expect(issues.map((issue) => issue.code)).toEqual([
      "package.environment.field.unsupported",
      "package.environment.secret_forbidden",
    ]);
  });

  test("forbidden-secret field scanners are exported for presence-triggered scans", () => {
    expect(
      findForbiddenMcpSecretFieldPath({
        mcpServers: { github: { token: "plaintext-value", type: "http" } },
      }),
    ).toBe("mcpServers.github.token");
    expect(
      findForbiddenMcpSecretFieldPath({
        mcpServers: { github: { type: "http", url: "https://mcp.github.example/mcp" } },
      }),
    ).toBeNull();
    expect(
      findForbiddenEnvironmentSidecarFieldPath({
        api_key: "plaintext-value",
        secretNames: ["SERVICE_TOKEN"],
      }),
    ).toBe("api_key");
    expect(findForbiddenEnvironmentSidecarFieldPath({ secretNames: ["SERVICE_TOKEN"] })).toBeNull();
  });

  test("manifest catalog issues split cleanly out of the sidecar collector", () => {
    const manifestJson = JSON.stringify({
      mcpServers: [{ enabled: true, name: "github", ref: ".mcp.json#github", transport: "http" }],
    });
    const entries = toArchiveEntries({
      ".agent/.mcp.json": JSON.stringify({
        mcpServers: { github: { type: "http", url: "https://mcp.github.example/mcp" } },
      }),
    });

    const catalogIssues = collectMcpManifestCatalogIssues(manifestJson);
    const mergedIssues = collectMcpSidecarIssues(manifestJson, entries);
    const sidecarOnlyIssues = collectMcpSidecarIssues(manifestJson, entries, {
      manifestCatalogIssues: "exclude",
    });

    expect(catalogIssues.map((issue) => issue.code)).toEqual(["package.mcp.field.unsupported"]);
    expect(mergedIssues.map((issue) => issue.code)).toEqual(["package.mcp.field.unsupported"]);
    expect(sidecarOnlyIssues).toEqual([]);
    expect([...sidecarOnlyIssues, ...catalogIssues]).toEqual(mergedIssues);
  });

  test("unsafe .agent entry paths fail archive entry admission", () => {
    const fixtureCase = findFixtureCase("red-agent-invalid-path");
    const candidates: AgentPackageArchiveEntryCandidate[] = Object.keys(
      toArchiveEntries(fixtureCase.files),
    ).map((path) => ({ entryKind: "file", originalPath: path }));
    const admission = admitAgentPackageArchiveEntries(candidates);

    expect(admission.ok).toBe(false);

    if (!admission.ok) {
      expect(admission.failure.code).toBe("package.archive.entry_parent_segment");
    }
  });
});
