/**
 * Repo fixtures for the Mosoo Native Deployment Protocol validator.
 *
 * Each fixture is a repo file map (repo-relative path → file content).
 * `expect` is validity: "green" means zero error-severity failures; warnings
 * and setup_required entries are allowed on green repos. `expectedCodes` is
 * the exact list of failure codes the validator must produce for the repo —
 * one entry per produced failure across all severities — sorted ascending.
 * Setup_required derivation is mechanical: whenever the primary manifest and
 * the relevant sidecar parse cleanly, one `native.setup.mcp_reconnect` per
 * declared MCP server and one `native.setup.environment_secret` per declared
 * environment secretName are produced, independent of content-level failures.
 */
import {
  AGENT_MANIFEST_VERSION,
  AGENT_PACKAGE_VERSION,
} from "../agent/agent-manifest-version.contract";
import { MOSOO_NATIVE_SPEC } from "./native-deployment.contract";
import type { NativeValidateFailureCode } from "./native-deployment.contract";

export interface NativeRepoFixtureCase {
  expect: "green" | "red";
  expectedCodes: readonly NativeValidateFailureCode[];
  files: Readonly<Record<string, string>>;
  name: string;
}

const NATIVE_MARKER_TOML = `spec = "${MOSOO_NATIVE_SPEC}"\n`;

function createAgentManifestJson(name: string, overrides: Record<string, unknown> = {}): string {
  const manifest: Record<string, unknown> = {
    description: `${name} fixture agent`,
    kind: "pet",
    manifestVersion: AGENT_MANIFEST_VERSION,
    mcpServers: [],
    model: "claude-sonnet-4-5",
    name,
    packageVersion: AGENT_PACKAGE_VERSION,
    prompts: { system: "You are a helpful fixture agent." },
    provider: "anthropic",
    runtime: "claude-agent-sdk",
    version: "1.0.0",
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete manifest[key];
      continue;
    }

    manifest[key] = value;
  }

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function toJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const NATIVE_REPO_SINGLE_AGENT_MINIMAL_FILES: Readonly<Record<string, string>> = {
  ".agent/manifest.json": createAgentManifestJson("quiz-master"),
  ".mosoo.toml": NATIVE_MARKER_TOML,
};

export const NATIVE_REPO_SINGLE_AGENT_WEB_FILES: Readonly<Record<string, string>> = {
  ".agent/manifest.json": createAgentManifestJson("quiz-master"),
  ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"

[expose.web]
build = "npm run build"
`,
  "src/index.html": "<!doctype html>\n<title>quiz</title>\n",
};

export const NATIVE_REPO_MULTI_AGENT_FILES: Readonly<Record<string, string>> = {
  ".agent/agents/support/manifest.json": createAgentManifestJson("support"),
  ".agent/agents/triage/manifest.json": createAgentManifestJson("triage"),
  ".agent/manifest.json": createAgentManifestJson("concierge"),
  ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"

[expose]
agents = ["concierge", "support"]
`,
};

export const NATIVE_REPO_FIXTURE_CASES: readonly NativeRepoFixtureCase[] = [
  {
    expect: "green",
    expectedCodes: [],
    files: NATIVE_REPO_SINGLE_AGENT_MINIMAL_FILES,
    name: "valid-single-agent-minimal",
  },
  {
    expect: "green",
    expectedCodes: [],
    files: NATIVE_REPO_SINGLE_AGENT_WEB_FILES,
    name: "valid-single-agent-web",
  },
  {
    expect: "green",
    expectedCodes: [],
    files: NATIVE_REPO_MULTI_AGENT_FILES,
    name: "valid-multi-agent",
  },
  {
    expect: "green",
    expectedCodes: ["native.setup.environment_secret", "native.setup.mcp_reconnect"],
    files: {
      ".agent/.mcp.json": toJsonFile({
        mcpServers: {
          github: {
            type: "http",
            url: "https://mcp.github.example/mcp",
          },
        },
      }),
      ".agent/environment/definition.json": toJsonFile({
        expectedName: "quiz",
        secretNames: ["OPENAI_API_KEY"],
        setupScript: "bun install",
      }),
      ".agent/manifest.json": createAgentManifestJson("quiz-master", {
        environment: { ref: "environment/definition.json" },
        mcpServers: [{ enabled: true, name: "github", ref: ".mcp.json#github" }],
      }),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    },
    name: "valid-single-agent-with-sidecar-setup",
  },
  {
    expect: "green",
    expectedCodes: ["native.toml.unknown_key"],
    files: {
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"
owner = "fixture"
`,
    },
    name: "valid-toml-unknown-key-warning",
  },
  {
    expect: "green",
    expectedCodes: ["native.expose.none"],
    files: {
      ".agent/agents/support/manifest.json": createAgentManifestJson("support"),
      ".agent/manifest.json": createAgentManifestJson("concierge"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"

[expose]
agents = []
`,
    },
    name: "valid-multi-agent-expose-none-warning",
  },
  {
    expect: "red",
    expectedCodes: ["native.toml.missing"],
    files: {
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
    },
    name: "red-toml-missing",
  },
  {
    expect: "red",
    expectedCodes: ["native.toml.parse_error"],
    files: {
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}`,
    },
    name: "red-toml-parse-error",
  },
  {
    expect: "red",
    expectedCodes: ["native.toml.spec_missing"],
    files: {
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
      ".mosoo.toml": "# mosoo native deployable\n",
    },
    name: "red-toml-spec-missing",
  },
  {
    expect: "red",
    expectedCodes: ["native.toml.spec_invalid"],
    files: {
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
      ".mosoo.toml": 'spec = "mosoo.spec.v2"\n',
    },
    name: "red-toml-spec-invalid",
  },
  {
    expect: "red",
    expectedCodes: ["native.toml.invalid_value"],
    files: {
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"

[expose]
agents = "quiz-master"
`,
    },
    name: "red-toml-invalid-value",
  },
  {
    expect: "red",
    expectedCodes: ["native.expose.channel_unsupported"],
    files: {
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"

[expose.channel]
`,
    },
    name: "red-expose-channel-unsupported",
  },
  {
    expect: "red",
    expectedCodes: ["native.expose.agents_required"],
    files: {
      ".agent/agents/support/manifest.json": createAgentManifestJson("support"),
      ".agent/manifest.json": createAgentManifestJson("concierge"),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    },
    name: "red-multi-agent-expose-agents-required",
  },
  {
    expect: "red",
    expectedCodes: ["native.expose.agent_unknown"],
    files: {
      ".agent/agents/support/manifest.json": createAgentManifestJson("support"),
      ".agent/manifest.json": createAgentManifestJson("concierge"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"

[expose]
agents = ["support", "ghost"]
`,
    },
    name: "red-expose-agent-unknown",
  },
  {
    expect: "red",
    expectedCodes: ["native.web.agent_unknown"],
    files: {
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"

[expose.web]
agent = "ghost"
`,
    },
    name: "red-web-agent-unknown",
  },
  {
    expect: "red",
    expectedCodes: ["native.web.agent_required"],
    files: {
      ".agent/agents/support/manifest.json": createAgentManifestJson("support"),
      ".agent/manifest.json": createAgentManifestJson("concierge"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"

[expose]
agents = ["concierge"]

[expose.web]
build = "npm run build"
`,
    },
    name: "red-web-agent-required",
  },
  {
    expect: "red",
    expectedCodes: ["native.agent.manifest_missing"],
    files: {
      ".mosoo.toml": NATIVE_MARKER_TOML,
    },
    name: "red-primary-manifest-missing",
  },
  {
    expect: "red",
    expectedCodes: ["native.agent.manifest_invalid"],
    files: {
      ".agent/manifest.json": createAgentManifestJson("quiz-master", { prompts: undefined }),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    },
    name: "red-agent-manifest-invalid",
  },
  {
    expect: "red",
    expectedCodes: ["native.agent.manifest_parse_error"],
    files: {
      ".agent/manifest.json": '{ "name": "quiz-master",',
      ".mosoo.toml": NATIVE_MARKER_TOML,
    },
    name: "red-agent-manifest-parse-error",
  },
  {
    expect: "red",
    expectedCodes: ["native.agent.mcp_secret_forbidden", "native.setup.mcp_reconnect"],
    files: {
      ".agent/.mcp.json": toJsonFile({
        mcpServers: {
          github: {
            token: "fixture-plaintext-value",
            type: "http",
            url: "https://mcp.github.example/mcp",
          },
        },
      }),
      ".agent/manifest.json": createAgentManifestJson("quiz-master", {
        mcpServers: [{ enabled: true, name: "github", ref: ".mcp.json#github" }],
      }),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    },
    name: "red-mcp-plaintext-secret",
  },
  {
    expect: "red",
    expectedCodes: [
      "native.agent.environment_invalid",
      "native.agent.environment_secret_forbidden",
      "native.setup.environment_secret",
    ],
    files: {
      ".agent/environment/definition.json": toJsonFile({
        api_key: "fixture-plaintext-value",
        secretNames: ["SERVICE_TOKEN"],
        setupScript: "",
      }),
      ".agent/manifest.json": createAgentManifestJson("quiz-master", {
        environment: { ref: "environment/definition.json" },
      }),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    },
    name: "red-environment-plaintext-secret",
  },
  {
    expect: "red",
    expectedCodes: ["native.agent.dir_name_mismatch"],
    files: {
      ".agent/agents/support/manifest.json": createAgentManifestJson("helpdesk"),
      ".agent/manifest.json": createAgentManifestJson("concierge"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"

[expose]
agents = ["concierge"]
`,
    },
    name: "red-agent-dir-name-mismatch",
  },
  {
    expect: "red",
    expectedCodes: ["native.agent.name_conflict"],
    files: {
      ".agent/agents/support/manifest.json": createAgentManifestJson("support"),
      ".agent/manifest.json": createAgentManifestJson("support"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"

[expose]
agents = ["support"]
`,
    },
    name: "red-agent-name-conflict",
  },
  {
    expect: "red",
    expectedCodes: ["native.agent.invalid_path"],
    files: {
      ".agent/manifest.json": createAgentManifestJson("quiz-master"),
      ".agent/skills/../../evil.txt": "must never be admitted\n",
      ".mosoo.toml": NATIVE_MARKER_TOML,
    },
    name: "red-agent-invalid-path",
  },
];
