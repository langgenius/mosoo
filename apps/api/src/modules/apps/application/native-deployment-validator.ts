/**
 * Mosoo Native Deployment Protocol v1 — pure repo validator (Phase 0).
 *
 * Single source of truth: docs/prd/mosoo-native-deployment-protocol.md
 * (Validator Contract). Takes a repo file snapshot and reports doctor-style
 * failures with machine-stable `native.*` codes so coding agents can repair
 * repos mechanically. Collects ALL failures instead of throwing; try/catch is
 * used only to convert JSON/TOML parse exceptions into diagnostics.
 *
 * Reuse boundaries (deliberate):
 * - Agent manifests are validated with the agent-package rules
 *   (`collectPackageIssues`); underlying `manifest.*` / `package.*` codes are
 *   mapped into the closed `native.*` set, with specifics kept in
 *   `field` / `problem`.
 * - Shared sidecars (`.agent/.mcp.json`, `.agent/environment/definition.json`)
 *   are content-validated against the PRIMARY manifest's catalogs only, and
 *   only when the primary manifest itself has no blocking issue (the catalogs
 *   must be trustworthy before sidecar content can be judged). Named agent
 *   manifests get manifest-level validation only (Phase 0 limitation).
 * - Setup requirements are derived mechanically whenever the primary manifest
 *   and the relevant sidecar parse cleanly, independent of content-level
 *   failures. An unparseable sidecar suppresses its setup entries because the
 *   declared servers/secrets cannot be read.
 * - Sidecar helpers speak archive-relative paths, so `.agent/` is stripped
 *   before calling them and re-prefixed onto every produced failure file (the
 *   PRD demands repo-term paths).
 */
import {
  admitAgentPackageArchiveEntries,
  collectEnvironmentSidecarIssues,
  collectMcpSidecarIssues,
} from "@mosoo/agent-package";
import type { AgentPackageArchiveEntryCandidate } from "@mosoo/agent-package";
import type { AgentResolutionIssue } from "@mosoo/contracts/agent-manifest";
import {
  collectPackageIssues,
  hasBlockingPackageIssue,
} from "@mosoo/contracts/agent-manifest-parser";
import {
  MOSOO_NATIVE_SPEC,
  NATIVE_AGENT_DIR,
  NATIVE_TOML_PATH,
  NATIVE_VALIDATE_SCHEMA_VERSION,
} from "@mosoo/contracts/native-deployment";
import type {
  NativeValidateAgentFact,
  NativeValidateFailure,
  NativeValidateResult,
} from "@mosoo/contracts/native-deployment";
import { parse as parseToml } from "smol-toml";

import type { AppDeploymentRepositorySnapshot } from "./app-deployment-detector";

const NATIVE_AGENT_DIR_PREFIX = `${NATIVE_AGENT_DIR}/`;
const PRIMARY_MANIFEST_PATH = `${NATIVE_AGENT_DIR}/manifest.json`;
const NAMED_AGENT_DIR_PREFIX = `${NATIVE_AGENT_DIR}/agents/`;
const NAMED_AGENT_MANIFEST_SUFFIX = "/manifest.json";
const MCP_SIDECAR_ARCHIVE_PATH = ".mcp.json";
const MCP_SIDECAR_REPO_PATH = `${NATIVE_AGENT_DIR}/${MCP_SIDECAR_ARCHIVE_PATH}`;
const ENVIRONMENT_DEFINITION_ARCHIVE_PATH = "environment/definition.json";
const ENVIRONMENT_DEFINITION_REPO_PATH = `${NATIVE_AGENT_DIR}/${ENVIRONMENT_DEFINITION_ARCHIVE_PATH}`;

const NATIVE_TOML_TOP_LEVEL_KEYS = new Set(["expose", "spec"]);
const NATIVE_TOML_EXPOSE_KEYS = new Set(["agents", "channel", "web"]);
const NATIVE_TOML_EXPOSE_WEB_KEYS = new Set(["agent", "build"]);

/**
 * Underlying manifest issue codes that identify a single dotted manifest
 * field; everything else keeps its specifics in `problem` only.
 */
const MANIFEST_ISSUE_FIELDS: Readonly<Record<string, string>> = {
  "manifest.kind.missing": "kind",
  "manifest.metadata.name.missing": "name",
  "manifest.model.missing": "model",
  "manifest.prompt.missing": "prompts.system",
  "manifest.runtime.missing": "runtime",
  "manifest.version.unsupported": "manifestVersion",
  "package.version.unsupported": "packageVersion",
};

/**
 * MCP issue codes raised against the manifest's server catalog rather than
 * the sidecar file. They are normally gated out by blocking manifest issues,
 * but the attribution is kept for safety.
 */
const MCP_CATALOG_ISSUE_CODES = new Set([
  "package.mcp.name.missing",
  "package.mcp.ref.mismatch",
  "package.mcp.ref.missing",
]);

const textEncoder = new TextEncoder();

interface DiscoveredAgent {
  hasBlockingIssue: boolean;
  manifestJson: string;
  manifestPath: string;
  name: string | null;
  parsed: Record<string, unknown> | null;
  source: "named" | "primary";
}

interface NativeTomlShape {
  /** Valid `expose.agents` names; null when the key is absent or malformed. */
  agentNames: readonly string[] | null;
  agentsDeclared: boolean;
  webAgentDeclared: boolean;
  webAgentName: string | null;
  webDeclared: boolean;
}

type AgentExposure =
  | { kind: "list"; names: ReadonlySet<string> }
  | { kind: "none" }
  | { kind: "primary_default" };

export function validateNativeDeployment(
  snapshot: AppDeploymentRepositorySnapshot,
): NativeValidateResult {
  const files = snapshot.files;
  const tomlSource = files[NATIVE_TOML_PATH];

  if (tomlSource === undefined) {
    return markerGateResult({
      action: `create ${NATIVE_TOML_PATH} at the repository root with spec = "${MOSOO_NATIVE_SPEC}"`,
      code: "native.toml.missing",
      file: NATIVE_TOML_PATH,
      problem: `repository has no ${NATIVE_TOML_PATH} marker at the root`,
      severity: "error",
    });
  }

  let tomlValue: unknown;

  try {
    tomlValue = parseToml(tomlSource);
  } catch (error) {
    return markerGateResult({
      action: `fix the TOML syntax in ${NATIVE_TOML_PATH}`,
      code: "native.toml.parse_error",
      file: NATIVE_TOML_PATH,
      problem: `${NATIVE_TOML_PATH} is not valid TOML: ${errorMessage(error)}`,
      severity: "error",
    });
  }

  if (!isRecord(tomlValue)) {
    return markerGateResult({
      action: `fix the TOML syntax in ${NATIVE_TOML_PATH}`,
      code: "native.toml.parse_error",
      file: NATIVE_TOML_PATH,
      problem: `${NATIVE_TOML_PATH} did not parse to a TOML table`,
      severity: "error",
    });
  }

  const spec = tomlValue["spec"];

  if (spec === undefined) {
    return markerGateResult({
      action: `set spec = "${MOSOO_NATIVE_SPEC}" in ${NATIVE_TOML_PATH}`,
      code: "native.toml.spec_missing",
      field: "spec",
      file: NATIVE_TOML_PATH,
      problem: `${NATIVE_TOML_PATH} does not declare spec`,
      severity: "error",
    });
  }

  if (spec !== MOSOO_NATIVE_SPEC) {
    return markerGateResult({
      action: `set spec = "${MOSOO_NATIVE_SPEC}" in ${NATIVE_TOML_PATH}`,
      code: "native.toml.spec_invalid",
      field: "spec",
      file: NATIVE_TOML_PATH,
      problem: `${NATIVE_TOML_PATH} spec is ${JSON.stringify(spec)} but must be "${MOSOO_NATIVE_SPEC}"`,
      severity: "error",
    });
  }

  const failures: NativeValidateFailure[] = [];
  const toml = readNativeTomlShape(tomlValue, failures);

  collectAgentPathAdmissionFailures(files, failures);

  const primaryAgent = discoverPrimaryAgent(files, failures);
  const namedAgents = discoverNamedAgents(files, failures);
  const agents = primaryAgent === null ? namedAgents : [primaryAgent, ...namedAgents];

  collectNameConflictFailures(agents, failures);

  const multiAgent = namedAgents.length > 0;
  const definedNames = new Set(
    agents.flatMap((agent) => (agent.name === null ? [] : [agent.name])),
  );
  const exposure = resolveAgentExposure(toml, multiAgent, definedNames, failures);
  const webAgent = resolveWebAgent(toml, multiAgent, definedNames, primaryAgent, failures);

  failures.push(...collectSidecarContentFailures(primaryAgent, files));
  failures.push(...deriveSetupFailures(primaryAgent, files));

  const agentFacts: NativeValidateAgentFact[] = [];

  for (const agent of agents) {
    if (agent.name === null) {
      continue;
    }

    agentFacts.push({
      exposed: isAgentExposed(agent, exposure),
      name: agent.name,
      source: agent.source,
    });
  }

  return {
    facts: {
      agentCount: agentFacts.length,
      agents: agentFacts,
      spec: MOSOO_NATIVE_SPEC,
      web: {
        ...(webAgent === null ? {} : { agent: webAgent }),
        declared: toml.webDeclared,
      },
    },
    failures,
    schemaVersion: NATIVE_VALIDATE_SCHEMA_VERSION,
    valid: failures.every((failure) => failure.severity !== "error"),
  };
}

function markerGateResult(failure: NativeValidateFailure): NativeValidateResult {
  return {
    facts: null,
    failures: [failure],
    schemaVersion: NATIVE_VALIDATE_SCHEMA_VERSION,
    valid: false,
  };
}

function readNativeTomlShape(
  value: Readonly<Record<string, unknown>>,
  failures: NativeValidateFailure[],
): NativeTomlShape {
  for (const key of Object.keys(value)) {
    if (!NATIVE_TOML_TOP_LEVEL_KEYS.has(key)) {
      failures.push(unknownTomlKeyFailure(key));
    }
  }

  const shape: {
    agentNames: readonly string[] | null;
    agentsDeclared: boolean;
    webAgentDeclared: boolean;
    webAgentName: string | null;
    webDeclared: boolean;
  } = {
    agentNames: null,
    agentsDeclared: false,
    webAgentDeclared: false,
    webAgentName: null,
    webDeclared: false,
  };
  const expose = value["expose"];

  if (expose === undefined) {
    return shape;
  }

  if (!isRecord(expose)) {
    failures.push(invalidTomlValueFailure("expose", "a table"));
    return shape;
  }

  for (const key of Object.keys(expose)) {
    if (!NATIVE_TOML_EXPOSE_KEYS.has(key)) {
      failures.push(unknownTomlKeyFailure(`expose.${key}`));
    }
  }

  if (expose["channel"] !== undefined) {
    failures.push({
      action: `remove [expose.channel] from ${NATIVE_TOML_PATH}; channel exposure ships after MVP`,
      code: "native.expose.channel_unsupported",
      field: "expose.channel",
      file: NATIVE_TOML_PATH,
      problem: "[expose.channel] is not supported by the protocol yet",
      severity: "error",
    });
  }

  const agents = expose["agents"];

  if (agents !== undefined) {
    shape.agentsDeclared = true;

    if (isStringArray(agents)) {
      shape.agentNames = agents;
    } else {
      failures.push(invalidTomlValueFailure("expose.agents", "an array of agent name strings"));
    }
  }

  const web = expose["web"];

  if (web === undefined) {
    return shape;
  }

  shape.webDeclared = true;

  if (!isRecord(web)) {
    failures.push(invalidTomlValueFailure("expose.web", "a table"));
    return shape;
  }

  for (const key of Object.keys(web)) {
    if (!NATIVE_TOML_EXPOSE_WEB_KEYS.has(key)) {
      failures.push(unknownTomlKeyFailure(`expose.web.${key}`));
    }
  }

  const webAgent = web["agent"];

  if (webAgent !== undefined) {
    shape.webAgentDeclared = true;

    if (typeof webAgent === "string") {
      shape.webAgentName = webAgent;
    } else {
      failures.push(invalidTomlValueFailure("expose.web.agent", "an agent name string"));
    }
  }

  const webBuild = web["build"];

  if (webBuild !== undefined && typeof webBuild !== "string") {
    failures.push(invalidTomlValueFailure("expose.web.build", "a shell command string"));
  }

  return shape;
}

function unknownTomlKeyFailure(field: string): NativeValidateFailure {
  return {
    action: `remove ${field} from ${NATIVE_TOML_PATH} or move it under a supported table`,
    code: "native.toml.unknown_key",
    field,
    file: NATIVE_TOML_PATH,
    problem: `${field} is not a recognized ${NATIVE_TOML_PATH} key`,
    severity: "warning",
  };
}

function invalidTomlValueFailure(field: string, expected: string): NativeValidateFailure {
  return {
    action: `set ${field} to ${expected} in ${NATIVE_TOML_PATH}`,
    code: "native.toml.invalid_value",
    field,
    file: NATIVE_TOML_PATH,
    problem: `${field} must be ${expected}`,
    severity: "error",
  };
}

function collectAgentPathAdmissionFailures(
  files: Readonly<Record<string, string>>,
  failures: NativeValidateFailure[],
): void {
  const candidates: AgentPackageArchiveEntryCandidate[] = Object.keys(files)
    .filter((path) => path.startsWith(NATIVE_AGENT_DIR_PREFIX))
    .toSorted()
    .map((path) => ({
      entryKind: "file",
      originalPath: path.slice(NATIVE_AGENT_DIR_PREFIX.length),
    }));
  const admission = admitAgentPackageArchiveEntries(candidates);

  if (admission.ok) {
    return;
  }

  const failedPath = admission.failure.path;

  failures.push({
    action: `rename the entry to a safe relative path inside ${NATIVE_AGENT_DIR}/`,
    code: "native.agent.invalid_path",
    file: failedPath === null ? NATIVE_AGENT_DIR : `${NATIVE_AGENT_DIR_PREFIX}${failedPath}`,
    problem: `${NATIVE_AGENT_DIR}/ entry path is not admissible: ${admission.failure.message} (${admission.failure.code})`,
    severity: "error",
  });
}

function discoverPrimaryAgent(
  files: Readonly<Record<string, string>>,
  failures: NativeValidateFailure[],
): DiscoveredAgent | null {
  const manifestJson = files[PRIMARY_MANIFEST_PATH];

  if (manifestJson === undefined) {
    failures.push({
      action: `create ${PRIMARY_MANIFEST_PATH} describing the primary agent`,
      code: "native.agent.manifest_missing",
      file: PRIMARY_MANIFEST_PATH,
      problem: `repository has no ${PRIMARY_MANIFEST_PATH}`,
      severity: "error",
    });
    return null;
  }

  return discoverAgent(PRIMARY_MANIFEST_PATH, manifestJson, "primary", failures);
}

function discoverNamedAgents(
  files: Readonly<Record<string, string>>,
  failures: NativeValidateFailure[],
): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];

  for (const path of Object.keys(files).toSorted()) {
    const dirName = readNamedAgentDirName(path);
    const manifestJson = files[path];

    if (dirName === null || manifestJson === undefined) {
      continue;
    }

    const agent = discoverAgent(path, manifestJson, "named", failures);

    if (agent.name !== null && agent.name !== dirName) {
      failures.push({
        action: `rename the directory to ${NAMED_AGENT_DIR_PREFIX}${agent.name}/ or set name to "${dirName}" in ${path}`,
        code: "native.agent.dir_name_mismatch",
        field: "name",
        file: path,
        problem: `manifest name "${agent.name}" does not match its directory "${dirName}"`,
        severity: "error",
      });
    }

    agents.push(agent);
  }

  return agents;
}

function readNamedAgentDirName(path: string): string | null {
  if (!path.startsWith(NAMED_AGENT_DIR_PREFIX) || !path.endsWith(NAMED_AGENT_MANIFEST_SUFFIX)) {
    return null;
  }

  const dirName = path.slice(
    NAMED_AGENT_DIR_PREFIX.length,
    path.length - NAMED_AGENT_MANIFEST_SUFFIX.length,
  );

  if (dirName.length === 0 || dirName.includes("/")) {
    return null;
  }

  return dirName;
}

function discoverAgent(
  manifestPath: string,
  manifestJson: string,
  source: "named" | "primary",
  failures: NativeValidateFailure[],
): DiscoveredAgent {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(manifestJson);
  } catch (error) {
    failures.push({
      action: `fix the JSON syntax in ${manifestPath}`,
      code: "native.agent.manifest_parse_error",
      file: manifestPath,
      problem: `${manifestPath} is not valid JSON: ${errorMessage(error)}`,
      severity: "error",
    });
    return {
      hasBlockingIssue: true,
      manifestJson,
      manifestPath,
      name: null,
      parsed: null,
      source,
    };
  }

  if (!isRecord(parsedValue)) {
    failures.push({
      action: `rewrite ${manifestPath} as a JSON object agent manifest`,
      code: "native.agent.manifest_invalid",
      file: manifestPath,
      problem: `${manifestPath} must be a JSON object`,
      severity: "error",
    });
    return {
      hasBlockingIssue: true,
      manifestJson,
      manifestPath,
      name: null,
      parsed: null,
      source,
    };
  }

  const issues = collectPackageIssues(parsedValue);

  for (const issue of issues) {
    failures.push(mapManifestIssue(issue, manifestPath));
  }

  const name = parsedValue["name"];

  return {
    hasBlockingIssue: hasBlockingPackageIssue(issues),
    manifestJson,
    manifestPath,
    name: typeof name === "string" && name.trim().length > 0 ? name : null,
    parsed: parsedValue,
    source,
  };
}

function mapManifestIssue(
  issue: AgentResolutionIssue,
  manifestPath: string,
): NativeValidateFailure {
  const blocking = hasBlockingPackageIssue([issue]);
  const field = MANIFEST_ISSUE_FIELDS[issue.code];

  return {
    action: `update ${manifestPath} so the agent manifest passes package validation`,
    code: blocking ? "native.agent.manifest_invalid" : "native.agent.manifest_warning",
    ...(field === undefined ? {} : { field }),
    file: manifestPath,
    problem: `${issue.message} (${issue.code})`,
    severity: blocking ? "error" : "warning",
  };
}

function collectNameConflictFailures(
  agents: readonly DiscoveredAgent[],
  failures: NativeValidateFailure[],
): void {
  const seenNames = new Set<string>();

  for (const agent of agents) {
    if (agent.name === null) {
      continue;
    }

    if (seenNames.has(agent.name)) {
      failures.push({
        action: `give each agent under ${NATIVE_AGENT_DIR}/ a unique manifest name`,
        code: "native.agent.name_conflict",
        field: "name",
        file: agent.manifestPath,
        problem: `agent name "${agent.name}" is defined more than once`,
        severity: "error",
      });
      continue;
    }

    seenNames.add(agent.name);
  }
}

function resolveAgentExposure(
  toml: NativeTomlShape,
  multiAgent: boolean,
  definedNames: ReadonlySet<string>,
  failures: NativeValidateFailure[],
): AgentExposure {
  if (!toml.agentsDeclared) {
    if (!multiAgent) {
      return { kind: "primary_default" };
    }

    failures.push({
      action: `declare [expose] agents = [...] in ${NATIVE_TOML_PATH} listing the agents to expose`,
      code: "native.expose.agents_required",
      field: "expose.agents",
      file: NATIVE_TOML_PATH,
      problem: "multi-agent repository does not declare which agents are exposed",
      severity: "error",
    });
    return { kind: "none" };
  }

  if (toml.agentNames === null) {
    // The malformed value already produced native.toml.invalid_value.
    return multiAgent ? { kind: "none" } : { kind: "primary_default" };
  }

  if (toml.agentNames.length === 0) {
    failures.push({
      action:
        "list at least one agent in expose.agents, or remove the key on a single-agent repository",
      code: "native.expose.none",
      field: "expose.agents",
      file: NATIVE_TOML_PATH,
      problem: "expose.agents is empty, so every agent stays internal",
      severity: "warning",
    });
    return { kind: "none" };
  }

  for (const name of toml.agentNames) {
    if (!definedNames.has(name)) {
      failures.push({
        action: `use a defined agent name in expose.agents or define the agent under ${NAMED_AGENT_DIR_PREFIX}${name}/`,
        code: "native.expose.agent_unknown",
        field: "expose.agents",
        file: NATIVE_TOML_PATH,
        problem: `expose.agents entry "${name}" does not match a defined agent`,
        severity: "error",
      });
    }
  }

  return { kind: "list", names: new Set(toml.agentNames) };
}

function isAgentExposed(agent: DiscoveredAgent, exposure: AgentExposure): boolean {
  switch (exposure.kind) {
    case "list":
      return agent.name !== null && exposure.names.has(agent.name);
    case "none":
      return false;
    case "primary_default":
      return agent.source === "primary";
  }
}

function resolveWebAgent(
  toml: NativeTomlShape,
  multiAgent: boolean,
  definedNames: ReadonlySet<string>,
  primaryAgent: DiscoveredAgent | null,
  failures: NativeValidateFailure[],
): string | null {
  if (!toml.webDeclared) {
    return null;
  }

  if (toml.webAgentName !== null) {
    if (definedNames.has(toml.webAgentName)) {
      return toml.webAgentName;
    }

    failures.push({
      action: `point expose.web.agent at a defined agent name in ${NATIVE_TOML_PATH}`,
      code: "native.web.agent_unknown",
      field: "expose.web.agent",
      file: NATIVE_TOML_PATH,
      problem: `expose.web agent "${toml.webAgentName}" does not match a defined agent`,
      severity: "error",
    });
    return null;
  }

  if (toml.webAgentDeclared) {
    // The malformed value already produced native.toml.invalid_value.
    return null;
  }

  if (multiAgent) {
    failures.push({
      action: `set agent = "<name>" under [expose.web] in ${NATIVE_TOML_PATH}`,
      code: "native.web.agent_required",
      field: "expose.web.agent",
      file: NATIVE_TOML_PATH,
      problem: "multi-agent repository declares [expose.web] without a target agent",
      severity: "error",
    });
    return null;
  }

  return primaryAgent?.name ?? null;
}

function collectSidecarContentFailures(
  primaryAgent: DiscoveredAgent | null,
  files: Readonly<Record<string, string>>,
): NativeValidateFailure[] {
  if (primaryAgent === null || primaryAgent.parsed === null || primaryAgent.hasBlockingIssue) {
    return [];
  }

  const entries = toArchiveEntries(files);
  const failures: NativeValidateFailure[] = [];

  try {
    for (const issue of collectMcpSidecarIssues(primaryAgent.manifestJson, entries)) {
      failures.push(mapMcpSidecarIssue(issue));
    }
  } catch (error) {
    failures.push({
      action: `fix the JSON syntax in ${MCP_SIDECAR_REPO_PATH}`,
      code: "native.agent.mcp_invalid",
      file: MCP_SIDECAR_REPO_PATH,
      problem: `${MCP_SIDECAR_REPO_PATH} is not readable as JSON: ${errorMessage(error)}`,
      severity: "error",
    });
  }

  try {
    for (const issue of collectEnvironmentSidecarIssues(primaryAgent.manifestJson, entries)) {
      failures.push(mapEnvironmentSidecarIssue(issue));
    }
  } catch (error) {
    failures.push({
      action: `fix the JSON syntax in ${ENVIRONMENT_DEFINITION_REPO_PATH}`,
      code: "native.agent.environment_invalid",
      file: ENVIRONMENT_DEFINITION_REPO_PATH,
      problem: `${ENVIRONMENT_DEFINITION_REPO_PATH} is not readable as JSON: ${errorMessage(error)}`,
      severity: "error",
    });
  }

  return failures;
}

function mapMcpSidecarIssue(issue: AgentResolutionIssue): NativeValidateFailure {
  if (issue.code === "package.mcp.secret_forbidden") {
    return {
      action: `remove the plaintext secret from ${MCP_SIDECAR_REPO_PATH}; credentials are connected on the target instance after deploy`,
      code: "native.agent.mcp_secret_forbidden",
      file: MCP_SIDECAR_REPO_PATH,
      problem: `${issue.message} (${issue.code})`,
      severity: "error",
    };
  }

  const file = MCP_CATALOG_ISSUE_CODES.has(issue.code)
    ? PRIMARY_MANIFEST_PATH
    : MCP_SIDECAR_REPO_PATH;

  return {
    action: `update ${file} so the MCP catalog and sidecar pass package validation`,
    code: "native.agent.mcp_invalid",
    file,
    problem: `${issue.message} (${issue.code})`,
    severity: issue.severity === "error" ? "error" : "warning",
  };
}

function mapEnvironmentSidecarIssue(issue: AgentResolutionIssue): NativeValidateFailure {
  if (issue.code === "package.environment.secret_forbidden") {
    return {
      action: `remove the plaintext secret from ${ENVIRONMENT_DEFINITION_REPO_PATH} and declare the name in secretNames instead`,
      code: "native.agent.environment_secret_forbidden",
      ...(issue.targetLabel === null ? {} : { field: issue.targetLabel }),
      file: ENVIRONMENT_DEFINITION_REPO_PATH,
      problem: `${issue.message} (${issue.code})`,
      severity: "error",
    };
  }

  return {
    action: `update ${ENVIRONMENT_DEFINITION_REPO_PATH} to declare only expectedName, secretNames, and setupScript`,
    code: "native.agent.environment_invalid",
    ...(issue.code === "package.environment.field.unsupported" && issue.targetLabel !== null
      ? { field: issue.targetLabel }
      : {}),
    file: ENVIRONMENT_DEFINITION_REPO_PATH,
    problem: `${issue.message} (${issue.code})`,
    severity: issue.severity === "error" ? "error" : "warning",
  };
}

function deriveSetupFailures(
  primaryAgent: DiscoveredAgent | null,
  files: Readonly<Record<string, string>>,
): NativeValidateFailure[] {
  if (primaryAgent === null || primaryAgent.parsed === null) {
    return [];
  }

  const failures: NativeValidateFailure[] = [];
  const mcpSource = files[MCP_SIDECAR_REPO_PATH];
  const catalogNames = readMcpCatalogNames(primaryAgent.parsed);

  if (
    catalogNames.length > 0 &&
    mcpSource !== undefined &&
    tryParseJsonRecord(mcpSource) !== null
  ) {
    for (const serverName of catalogNames) {
      failures.push({
        action: `connect MCP server "${serverName}" on the target instance after deploy`,
        code: "native.setup.mcp_reconnect",
        file: MCP_SIDECAR_REPO_PATH,
        problem: `MCP server "${serverName}" ships without credentials, so its connection is not portable`,
        severity: "setup_required",
      });
    }
  }

  const definitionSource = files[ENVIRONMENT_DEFINITION_REPO_PATH];

  if (
    readEnvironmentRef(primaryAgent.parsed) !== ENVIRONMENT_DEFINITION_ARCHIVE_PATH ||
    definitionSource === undefined
  ) {
    return failures;
  }

  const definition = tryParseJsonRecord(definitionSource);

  if (definition === null) {
    return failures;
  }

  for (const secretName of readSecretNames(definition)) {
    failures.push({
      action: `set environment secret ${secretName} on the target instance after deploy`,
      code: "native.setup.environment_secret",
      field: "secretNames",
      file: ENVIRONMENT_DEFINITION_REPO_PATH,
      problem: `environment secret ${secretName} is declared without a value; secret values never ship in the repository`,
      severity: "setup_required",
    });
  }

  return failures;
}

function readMcpCatalogNames(manifest: Readonly<Record<string, unknown>>): string[] {
  const catalog = manifest["mcpServers"];

  if (!Array.isArray(catalog)) {
    return [];
  }

  const names = new Set<string>();

  for (const entry of catalog) {
    if (isRecord(entry) && typeof entry["name"] === "string" && entry["name"].length > 0) {
      names.add(entry["name"]);
    }
  }

  return [...names].toSorted();
}

function readEnvironmentRef(manifest: Readonly<Record<string, unknown>>): string | null {
  const environment = manifest["environment"];

  if (!isRecord(environment)) {
    return null;
  }

  const ref = environment["ref"];

  return typeof ref === "string" ? ref : null;
}

function readSecretNames(definition: Readonly<Record<string, unknown>>): string[] {
  const secretNames = definition["secretNames"];

  if (!Array.isArray(secretNames)) {
    return [];
  }

  const names = new Set<string>();

  for (const secretName of secretNames) {
    if (typeof secretName === "string" && secretName.length > 0) {
      names.add(secretName);
    }
  }

  return [...names].toSorted();
}

function toArchiveEntries(files: Readonly<Record<string, string>>): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};

  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith(NATIVE_AGENT_DIR_PREFIX)) {
      entries[path.slice(NATIVE_AGENT_DIR_PREFIX.length)] = textEncoder.encode(content);
    }
  }

  return entries;
}

function tryParseJsonRecord(source: string): Record<string, unknown> | null {
  let value: unknown;

  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }

  return isRecord(value) ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
