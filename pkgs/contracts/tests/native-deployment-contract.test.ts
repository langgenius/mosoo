import { describe, expect, test } from "bun:test";

import {
  collectPackageIssues,
  hasBlockingPackageIssue,
} from "@mosoo/contracts/agent-manifest-parser";
import {
  MOSOO_NATIVE_SPEC,
  NATIVE_AGENT_DIR,
  NATIVE_TOML_PATH,
  NATIVE_VALIDATE_FAILURE_CODES,
  NATIVE_VALIDATE_SCHEMA_VERSION,
} from "@mosoo/contracts/native-deployment";
import {
  NATIVE_REPO_FIXTURE_CASES,
  NATIVE_REPO_MULTI_AGENT_FILES,
  NATIVE_REPO_SINGLE_AGENT_MINIMAL_FILES,
  NATIVE_REPO_SINGLE_AGENT_WEB_FILES,
} from "@mosoo/contracts/native-repo-fixtures";

describe("native deployment validate contract", () => {
  test("locks the closed failure code set", () => {
    expect([...NATIVE_VALIDATE_FAILURE_CODES]).toEqual([
      "native.agent.dir_name_mismatch",
      "native.agent.environment_invalid",
      "native.agent.environment_secret_forbidden",
      "native.agent.invalid_path",
      "native.agent.manifest_invalid",
      "native.agent.manifest_missing",
      "native.agent.manifest_parse_error",
      "native.agent.mcp_invalid",
      "native.agent.mcp_secret_forbidden",
      "native.agent.name_conflict",
      "native.agent.name_not_url_safe",
      "native.expose.agent_unknown",
      "native.expose.agents_required",
      "native.expose.channel_unsupported",
      "native.expose.none",
      "native.setup.environment_secret",
      "native.setup.mcp_reconnect",
      "native.toml.invalid_value",
      "native.toml.missing",
      "native.toml.parse_error",
      "native.toml.spec_invalid",
      "native.toml.spec_missing",
      "native.toml.unknown_key",
      "native.web.agent_required",
      "native.web.agent_unknown",
    ]);
  });

  test("keeps the failure code set sorted and duplicate free", () => {
    const codes = [...NATIVE_VALIDATE_FAILURE_CODES];

    expect(codes).toEqual([...codes].toSorted());
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("locks the validate schema version and repo markers", () => {
    expect(NATIVE_VALIDATE_SCHEMA_VERSION).toBe(1);
    expect(MOSOO_NATIVE_SPEC).toBe("mosoo.spec.v1");
    expect(NATIVE_TOML_PATH).toBe(".mosoo.toml");
    expect(NATIVE_AGENT_DIR).toBe(".agent");
  });

  test("fixture case names are unique and cover the brief minimum", () => {
    const names = NATIVE_REPO_FIXTURE_CASES.map((fixtureCase) => fixtureCase.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(12);
  });

  test("every fixture expected code is inside the closed set and sorted", () => {
    const closedSet = new Set<string>(NATIVE_VALIDATE_FAILURE_CODES);

    for (const fixtureCase of NATIVE_REPO_FIXTURE_CASES) {
      expect([...fixtureCase.expectedCodes]).toEqual([...fixtureCase.expectedCodes].toSorted());

      for (const code of fixtureCase.expectedCodes) {
        expect(closedSet.has(code)).toBe(true);
      }
    }
  });

  test("red fixtures always expect at least one failure code", () => {
    for (const fixtureCase of NATIVE_REPO_FIXTURE_CASES) {
      if (fixtureCase.expect === "red") {
        expect(fixtureCase.expectedCodes.length).toBeGreaterThan(0);
      }
    }
  });

  test("named green file maps are the case-table entries", () => {
    const filesByName = new Map(
      NATIVE_REPO_FIXTURE_CASES.map((fixtureCase) => [fixtureCase.name, fixtureCase.files]),
    );

    expect(filesByName.get("valid-single-agent-minimal")).toBe(
      NATIVE_REPO_SINGLE_AGENT_MINIMAL_FILES,
    );
    expect(filesByName.get("valid-single-agent-web")).toBe(NATIVE_REPO_SINGLE_AGENT_WEB_FILES);
    expect(filesByName.get("valid-multi-agent")).toBe(NATIVE_REPO_MULTI_AGENT_FILES);
  });

  test("green fixture agent manifests pass the reused package validation", () => {
    for (const fixtureCase of NATIVE_REPO_FIXTURE_CASES) {
      if (fixtureCase.expect !== "green") {
        continue;
      }

      for (const [path, content] of Object.entries(fixtureCase.files)) {
        if (!path.startsWith(".agent/") || !path.endsWith("manifest.json")) {
          continue;
        }

        const parsed: unknown = JSON.parse(content);

        expect(parsed !== null && typeof parsed === "object").toBe(true);

        const issues = collectPackageIssues(parsed as Record<string, unknown>);

        expect(issues.map((issue) => `${fixtureCase.name} ${path} ${issue.code}`)).toEqual([]);
        expect(hasBlockingPackageIssue(issues)).toBe(false);
      }
    }
  });
});
