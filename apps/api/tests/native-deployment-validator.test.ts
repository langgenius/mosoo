import { describe, expect, test } from "bun:test";

import type { NativeValidateResult } from "@mosoo/contracts/native-deployment";
import {
  createAgentManifestJson,
  NATIVE_REPO_FIXTURE_CASES,
  NATIVE_REPO_MULTI_AGENT_FILES,
  NATIVE_REPO_SINGLE_AGENT_MINIMAL_FILES,
  NATIVE_REPO_SINGLE_AGENT_WEB_FILES,
} from "@mosoo/contracts/native-repo-fixtures";
import type { NativeRepoFixtureCase } from "@mosoo/contracts/native-repo-fixtures";

import { validateNativeDeployment } from "../src/modules/apps/application/native-deployment-validator";

const NATIVE_MARKER_TOML = 'spec = "mosoo.spec.v1"\n';

const SECRET_MCP_SIDECAR_JSON = `${JSON.stringify(
  {
    mcpServers: {
      github: {
        token: "test-plaintext-value",
        type: "http",
        url: "https://mcp.github.example/mcp",
      },
    },
  },
  null,
  2,
)}\n`;

function validate(files: Readonly<Record<string, string>>): NativeValidateResult {
  return validateNativeDeployment({ files });
}

function sortedCodes(result: NativeValidateResult): string[] {
  return result.failures.map((failure) => failure.code).toSorted();
}

function findFixtureCase(name: string): NativeRepoFixtureCase {
  const fixtureCase = NATIVE_REPO_FIXTURE_CASES.find((entry) => entry.name === name);

  if (fixtureCase === undefined) {
    throw new Error(`Fixture case ${name} is missing.`);
  }

  return fixtureCase;
}

describe("native deployment validator", () => {
  for (const fixtureCase of NATIVE_REPO_FIXTURE_CASES) {
    test(`fixture ${fixtureCase.name} produces exactly the expected codes`, () => {
      const result = validate(fixtureCase.files);

      expect(sortedCodes(result)).toEqual([...fixtureCase.expectedCodes]);
      expect(result.valid).toBe(fixtureCase.expect === "green");
      expect(result.failures.some((failure) => failure.severity === "error")).toBe(
        fixtureCase.expect === "red",
      );
      expect(result.schemaVersion).toBe(1);
    });
  }

  test("every failure carries a repo-term file path and repairable text", () => {
    const offenders: string[] = [];

    for (const fixtureCase of NATIVE_REPO_FIXTURE_CASES) {
      for (const failure of validate(fixtureCase.files).failures) {
        const repoTermFile = failure.file === ".mosoo.toml" || failure.file.startsWith(".agent/");

        if (!repoTermFile || failure.problem.length === 0 || failure.action.length === 0) {
          offenders.push(`${fixtureCase.name} ${failure.code} ${failure.file}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("single-agent facts expose the primary agent by default", () => {
    expect(validate(NATIVE_REPO_SINGLE_AGENT_MINIMAL_FILES).facts).toEqual({
      agentCount: 1,
      agents: [{ exposed: true, name: "quiz-master", source: "primary" }],
      spec: "mosoo.spec.v1",
      web: { declared: false },
    });
  });

  test("single-agent web facts default the web target to the primary agent", () => {
    expect(validate(NATIVE_REPO_SINGLE_AGENT_WEB_FILES).facts?.web).toEqual({
      agent: "quiz-master",
      declared: true,
    });
  });

  test("multi-agent facts derive exposure from the expose list", () => {
    const facts = validate(NATIVE_REPO_MULTI_AGENT_FILES).facts;

    expect(facts?.agentCount).toBe(3);
    expect(facts?.agents).toEqual([
      { exposed: true, name: "concierge", source: "primary" },
      { exposed: true, name: "support", source: "named" },
      { exposed: false, name: "triage", source: "named" },
    ]);
    expect(facts?.web).toEqual({ declared: false });
  });

  test("facts are null when the marker gate fails", () => {
    expect(validate({}).facts).toBeNull();
    expect(validate({ ".mosoo.toml": 'spec = "mosoo.spec.v1' }).facts).toBeNull();
    expect(validate({ ".mosoo.toml": "# no spec\n" }).facts).toBeNull();
    expect(validate({ ".mosoo.toml": 'spec = "mosoo.spec.v2"\n' }).facts).toBeNull();
  });

  test("manifest failures keep repo-term paths and derived fields", () => {
    const result = validate(findFixtureCase("red-agent-manifest-invalid").files);

    expect(result.failures).toEqual([
      {
        action: "update .agent/manifest.json so the agent manifest passes package validation",
        code: "native.agent.manifest_invalid",
        field: "prompts.system",
        file: ".agent/manifest.json",
        problem: "Manifest prompts.system is required. (manifest.prompt.missing)",
        severity: "error",
      },
    ]);
  });

  test("rejects plaintext mcp secrets with an error on the sidecar file", () => {
    const result = validate(findFixtureCase("red-mcp-plaintext-secret").files);
    const secret = result.failures.find(
      (failure) => failure.code === "native.agent.mcp_secret_forbidden",
    );

    expect(result.valid).toBe(false);
    expect(secret).toMatchObject({ file: ".agent/.mcp.json", severity: "error" });
    expect(secret?.problem).toContain("token");
    expect(secret?.problem).toContain("package.mcp.secret_forbidden");
  });

  test("rejects plaintext environment secrets with an error on the sidecar file", () => {
    const result = validate(findFixtureCase("red-environment-plaintext-secret").files);
    const secret = result.failures.find(
      (failure) => failure.code === "native.agent.environment_secret_forbidden",
    );

    expect(result.valid).toBe(false);
    expect(secret).toMatchObject({
      field: "api_key",
      file: ".agent/environment/definition.json",
      severity: "error",
    });
    expect(secret?.problem).toContain("package.environment.secret_forbidden");
  });

  test("setup_required entries carry actionable post-deploy instructions", () => {
    const result = validate(findFixtureCase("valid-single-agent-with-sidecar-setup").files);
    const setup = result.failures.filter((failure) => failure.severity === "setup_required");

    expect(result.valid).toBe(true);
    expect(setup.map((failure) => failure.code).toSorted()).toEqual([
      "native.setup.environment_secret",
      "native.setup.mcp_reconnect",
    ]);

    const reconnect = setup.find((failure) => failure.code === "native.setup.mcp_reconnect");
    const secret = setup.find((failure) => failure.code === "native.setup.environment_secret");

    expect(reconnect?.file).toBe(".agent/.mcp.json");
    expect(reconnect?.action).toContain("github");
    expect(reconnect?.action).toContain("after deploy");
    expect(secret?.file).toBe(".agent/environment/definition.json");
    expect(secret?.action).toContain("OPENAI_API_KEY");
    expect(secret?.action).toContain("after deploy");
  });

  test("re-prefixes .agent/ onto path admission failures", () => {
    const result = validate(findFixtureCase("red-agent-invalid-path").files);
    const failure = result.failures.find((entry) => entry.code === "native.agent.invalid_path");

    expect(failure?.file).toBe(".agent/skills/../../evil.txt");
  });

  test("marks unknown toml keys as warnings with the offending field", () => {
    const result = validate(findFixtureCase("valid-toml-unknown-key-warning").files);

    expect(result.valid).toBe(true);
    expect(result.failures).toEqual([
      {
        action: "remove owner from .mosoo.toml or move it under a supported table",
        code: "native.toml.unknown_key",
        field: "owner",
        file: ".mosoo.toml",
        problem: "owner is not a recognized .mosoo.toml key",
        severity: "warning",
      },
    ]);
  });

  test("converts malformed mcp sidecar json into a diagnostic", () => {
    const result = validate({
      ...NATIVE_REPO_SINGLE_AGENT_MINIMAL_FILES,
      ".agent/.mcp.json": "{ not json",
    });

    expect(sortedCodes(result)).toEqual(["native.agent.mcp_invalid"]);
    expect(result.failures[0]?.file).toBe(".agent/.mcp.json");
    expect(result.valid).toBe(false);
  });

  test("converts malformed environment json into a diagnostic and suppresses its setup entry", () => {
    const sidecarFixture = findFixtureCase("valid-single-agent-with-sidecar-setup");
    const result = validate({
      ...sidecarFixture.files,
      ".agent/environment/definition.json": "{ not json",
    });

    expect(sortedCodes(result)).toEqual([
      "native.agent.environment_invalid",
      "native.setup.mcp_reconnect",
    ]);
    expect(
      result.failures.find((failure) => failure.code === "native.agent.environment_invalid")?.file,
    ).toBe(".agent/environment/definition.json");
    expect(result.valid).toBe(false);
  });

  test("rejects sidecar secrets when the manifest omits the mcpServers catalog", () => {
    const result = validate(findFixtureCase("red-mcp-secret-without-catalog").files);
    const secret = result.failures.find(
      (failure) => failure.code === "native.agent.mcp_secret_forbidden",
    );
    const orphan = result.failures.find((failure) => failure.code === "native.agent.mcp_invalid");

    expect(result.valid).toBe(false);
    expect(secret).toMatchObject({
      field: "mcpServers.github.token",
      file: ".agent/.mcp.json",
      severity: "error",
    });
    expect(orphan?.problem).toContain("no agent manifest declares a mcpServers catalog");
  });

  test("rejects sidecar secrets behind a mistyped mcpServers catalog", () => {
    const result = validate({
      ".agent/.mcp.json": SECRET_MCP_SIDECAR_JSON,
      ".agent/manifest.json": createAgentManifestJson("quiz-master", { mcpServers: "github" }),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    });

    expect(sortedCodes(result)).toEqual([
      "native.agent.mcp_invalid",
      "native.agent.mcp_secret_forbidden",
    ]);
    expect(result.valid).toBe(false);
  });

  test("scans mcp sidecar secrets even when the primary manifest is missing", () => {
    const result = validate({
      ".agent/.mcp.json": '{ "github": { "token": "test-plaintext-value" } }\n',
      ".mosoo.toml": NATIVE_MARKER_TOML,
    });
    const secret = result.failures.find(
      (failure) => failure.code === "native.agent.mcp_secret_forbidden",
    );

    expect(result.valid).toBe(false);
    expect(secret).toMatchObject({ field: "github.token", file: ".agent/.mcp.json" });
    expect(sortedCodes(result)).toContain("native.agent.manifest_missing");
  });

  test("reports the secret code for servers an empty catalog leaves unreferenced", () => {
    const result = validate({
      ".agent/.mcp.json": SECRET_MCP_SIDECAR_JSON,
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    });

    expect(sortedCodes(result)).toEqual([
      "native.agent.mcp_invalid",
      "native.agent.mcp_secret_forbidden",
    ]);
    expect(
      result.failures.find((failure) => failure.code === "native.agent.mcp_invalid")?.problem,
    ).toContain("is not declared by any agent manifest");
  });

  test("rejects environment secrets when no manifest references the definition", () => {
    const result = validate(findFixtureCase("red-environment-secret-without-reference").files);
    const secret = result.failures.find(
      (failure) => failure.code === "native.agent.environment_secret_forbidden",
    );
    const orphan = result.failures.find(
      (failure) => failure.code === "native.agent.environment_invalid",
    );

    expect(result.valid).toBe(false);
    expect(secret).toMatchObject({
      field: "api_key",
      file: ".agent/environment/definition.json",
      severity: "error",
    });
    expect(orphan?.problem).toContain("no agent manifest references it");
  });

  test("keeps the shared mcp sidecar green when only a named agent references it", () => {
    const result = validate(findFixtureCase("valid-multi-agent-shared-mcp-sidecar").files);

    expect(result.valid).toBe(true);
    expect(sortedCodes(result)).toEqual(["native.setup.mcp_reconnect"]);
    expect(result.failures[0]?.action).toContain("github");
  });

  test("unions reference coverage and setup across primary and named catalogs", () => {
    const result = validate({
      ".agent/.mcp.json": `${JSON.stringify(
        {
          mcpServers: {
            github: { type: "http", url: "https://mcp.github.example/mcp" },
            linear: { type: "http", url: "https://mcp.linear.example/mcp" },
          },
        },
        null,
        2,
      )}\n`,
      ".agent/agents/support/manifest.json": createAgentManifestJson("support", {
        mcpServers: [{ enabled: true, name: "github", ref: ".mcp.json#github" }],
      }),
      ".agent/manifest.json": createAgentManifestJson("concierge", {
        mcpServers: [{ enabled: true, name: "linear", ref: ".mcp.json#linear" }],
      }),
      ".mosoo.toml": 'spec = "mosoo.spec.v1"\n\n[expose]\nagents = ["concierge", "support"]\n',
    });

    expect(result.valid).toBe(true);
    expect(sortedCodes(result)).toEqual([
      "native.setup.mcp_reconnect",
      "native.setup.mcp_reconnect",
    ]);
  });

  test("rejects toml datetime values where tables are required", () => {
    const base = { ".agent/manifest.json": createAgentManifestJson("quiz-master") };
    const exposeDate = validate({
      ...base,
      ".mosoo.toml": 'spec = "mosoo.spec.v1"\nexpose = 2020-01-01T00:00:00Z\n',
    });
    const webDate = validate({
      ...base,
      ".mosoo.toml": 'spec = "mosoo.spec.v1"\n\n[expose]\nweb = 2020-01-01T00:00:00Z\n',
    });

    expect(sortedCodes(exposeDate)).toEqual(["native.toml.invalid_value"]);
    expect(exposeDate.valid).toBe(false);
    expect(sortedCodes(webDate)).toEqual(["native.toml.invalid_value"]);
    expect(webDate.valid).toBe(false);
    expect(webDate.failures[0]?.field).toBe("expose.web");
  });
});
