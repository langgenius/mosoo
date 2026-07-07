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
 *   are content-validated against the PRIMARY manifest's catalogs by the
 *   reused package delegates, and only when the primary manifest itself has
 *   no blocking issue (the catalogs must be trustworthy before sidecar
 *   content can be judged against them). Named agent manifests get
 *   manifest-level validation only (Phase 0 limitation), but they DO
 *   participate in reference coverage below.
 * - Native checks trigger on the physical presence of a sidecar file,
 *   whatever the manifests declare: the file must parse as JSON, must not
 *   carry forbidden plaintext-secret fields anywhere, and must be referenced
 *   by a well-typed catalog in at least one agent manifest. Reference
 *   coverage (orphaned sidecars, undeclared servers) is judged across the
 *   union of primary and named manifests, because the PRD lets shared
 *   sidecars be referenced from named agent manifests alone.
 * - Setup requirements are derived mechanically whenever agent manifests and
 *   the relevant sidecar parse cleanly, unioned across all agent manifests,
 *   independent of content-level failures. An unparseable sidecar suppresses
 *   its setup entries because the declared servers/secrets cannot be read.
 * - Sidecar helpers speak archive-relative paths, so `.agent/` is stripped
 *   before calling them and re-prefixed onto every produced failure file (the
 *   PRD demands repo-term paths).
 */
import {
  admitAgentPackageArchiveEntries,
  collectEnvironmentSidecarIssues,
  collectMcpManifestCatalogIssues,
  collectMcpSidecarIssues,
  findForbiddenEnvironmentSidecarFieldPath,
  findForbiddenMcpSecretFieldPath,
} from "@mosoo/agent-package";
import type { AgentPackageArchiveEntryCandidate } from "@mosoo/agent-package";
import { AGENT_PACKAGE_ISSUE_CODES } from "@mosoo/contracts/agent-manifest";
import type { AgentPackageIssueCode, AgentResolutionIssue } from "@mosoo/contracts/agent-manifest";
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
 * Exposed agent names become URL path segments of the App API namespace
 * (`…/apps/{app-slug}/agents/{name}/threads`), so they must be URL-safe
 * kebab-case. Enforced ONLY for agents inside the expose subset; internal
 * agent names stay unconstrained (PRD "API Namespace & Access").
 */
const EXPOSED_AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Underlying manifest issue codes that identify a single dotted manifest
 * field; everything else keeps its specifics in `problem` only. Keyed by the
 * contracts-exported issue-code constants so the mapping cannot drift from
 * the codes the reused package validation actually mints.
 */
const MANIFEST_ISSUE_FIELDS: Readonly<Partial<Record<AgentPackageIssueCode, string>>> = {
  [AGENT_PACKAGE_ISSUE_CODES.manifestKindMissing]: "kind",
  [AGENT_PACKAGE_ISSUE_CODES.manifestNameMissing]: "name",
  [AGENT_PACKAGE_ISSUE_CODES.manifestModelMissing]: "model",
  [AGENT_PACKAGE_ISSUE_CODES.manifestPromptMissing]: "prompts.system",
  [AGENT_PACKAGE_ISSUE_CODES.manifestRuntimeMissing]: "runtime",
  [AGENT_PACKAGE_ISSUE_CODES.manifestVersionUnsupported]: "manifestVersion",
  [AGENT_PACKAGE_ISSUE_CODES.packageVersionUnsupported]: "packageVersion",
};

const AGENT_PACKAGE_ISSUE_CODE_SET: ReadonlySet<string> = new Set(
  Object.values(AGENT_PACKAGE_ISSUE_CODES),
);

function isAgentPackageIssueCode(code: string): code is AgentPackageIssueCode {
  return AGENT_PACKAGE_ISSUE_CODE_SET.has(code);
}

function readManifestIssueField(code: string): string | undefined {
  return isAgentPackageIssueCode(code) ? MANIFEST_ISSUE_FIELDS[code] : undefined;
}

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

type SidecarJsonParse =
  | { kind: "absent" }
  | { kind: "invalid"; message: string }
  | { kind: "parsed"; value: unknown };

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
  collectNamedAgentLayoutFailures(files, failures);

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

  collectExposedAgentNameFailures(agents, exposure, failures);
  failures.push(...collectSidecarContentFailures(agents, primaryAgent, files));
  failures.push(...deriveSetupFailures(agents, files));

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

/**
 * Reports EVERY inadmissible `.agent/` path: per-path admission runs entry by
 * entry so one bad path cannot shadow the rest, and the admissible remainder
 * still goes through batch admission for its cross-entry rules (duplicate or
 * nested-under-file collisions, which a repo file walk cannot normally
 * produce).
 */
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
  const admissibleCandidates: AgentPackageArchiveEntryCandidate[] = [];

  for (const candidate of candidates) {
    const admission = admitAgentPackageArchiveEntries([candidate]);

    if (admission.ok) {
      admissibleCandidates.push(candidate);
      continue;
    }

    failures.push(toPathAdmissionFailure(admission.failure.path, admission.failure));
  }

  const batchAdmission = admitAgentPackageArchiveEntries(admissibleCandidates);

  if (!batchAdmission.ok) {
    failures.push(toPathAdmissionFailure(batchAdmission.failure.path, batchAdmission.failure));
  }
}

function toPathAdmissionFailure(
  failedPath: string | null,
  failure: { code: string; message: string },
): NativeValidateFailure {
  return {
    action: `rename the entry to a safe relative path inside ${NATIVE_AGENT_DIR}/`,
    code: "native.agent.invalid_path",
    file: failedPath === null ? NATIVE_AGENT_DIR : `${NATIVE_AGENT_DIR_PREFIX}${failedPath}`,
    problem: `${NATIVE_AGENT_DIR}/ entry path is not admissible: ${failure.message} (${failure.code})`,
    severity: "error",
  };
}

/**
 * Misplaced named-agent manifests are layout errors, never silently dropped:
 * every `manifest.json` under `.agent/agents/` must sit exactly at
 * `.agent/agents/<agent-name>/manifest.json` (pinned to
 * `native.agent.invalid_path`), and every agent directory implied by any
 * `.agent/agents/<agent-name>/...` entry must contain a root manifest
 * (`native.agent.manifest_missing` at the expected path). A nested manifest
 * raises both: the misplacement and the manifest its directory still lacks.
 */
function collectNamedAgentLayoutFailures(
  files: Readonly<Record<string, string>>,
  failures: NativeValidateFailure[],
): void {
  const impliedAgentDirNames = new Set<string>();

  for (const path of Object.keys(files).toSorted()) {
    if (!path.startsWith(NAMED_AGENT_DIR_PREFIX)) {
      continue;
    }

    const remainder = path.slice(NAMED_AGENT_DIR_PREFIX.length);
    const separatorIndex = remainder.indexOf("/");

    if (separatorIndex > 0) {
      impliedAgentDirNames.add(remainder.slice(0, separatorIndex));
    }

    if (path.endsWith(NAMED_AGENT_MANIFEST_SUFFIX) && readNamedAgentDirName(path) === null) {
      failures.push({
        action: `move ${path} to ${NAMED_AGENT_DIR_PREFIX}<agent-name>/manifest.json for its agent`,
        code: "native.agent.invalid_path",
        file: path,
        problem: `named agent manifests must sit exactly at ${NAMED_AGENT_DIR_PREFIX}<agent-name>/manifest.json`,
        severity: "error",
      });
    }
  }

  for (const dirName of [...impliedAgentDirNames].toSorted()) {
    const manifestPath = `${NAMED_AGENT_DIR_PREFIX}${dirName}/manifest.json`;

    if (files[manifestPath] === undefined) {
      failures.push({
        action: `create ${manifestPath} describing the agent, or remove the ${NAMED_AGENT_DIR_PREFIX}${dirName}/ directory`,
        code: "native.agent.manifest_missing",
        file: manifestPath,
        problem: `agent directory ${NAMED_AGENT_DIR_PREFIX}${dirName}/ has no manifest.json`,
        severity: "error",
      });
    }
  }
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

/**
 * Every issue `collectPackageIssues` mints today is blocking (unsupported
 * status or a required-field code), so manifest issues map fail-closed to
 * error-severity `native.agent.manifest_invalid`. If the reused validation
 * ever grows non-blocking issues, revisit this mapping before giving the
 * closed code set a manifest warning story again.
 */
function mapManifestIssue(
  issue: AgentResolutionIssue,
  manifestPath: string,
): NativeValidateFailure {
  const field = readManifestIssueField(issue.code);

  return {
    action: `update ${manifestPath} so the agent manifest passes package validation`,
    code: "native.agent.manifest_invalid",
    ...(field === undefined ? {} : { field }),
    file: manifestPath,
    problem: `${issue.message} (${issue.code})`,
    severity: "error",
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

/**
 * URL-safety gate for the expose subset only: an exposed agent's name is the
 * public path segment addressing it, so it must match
 * {@link EXPOSED_AGENT_NAME_PATTERN}. Internal agents deploy with any name.
 */
function collectExposedAgentNameFailures(
  agents: readonly DiscoveredAgent[],
  exposure: AgentExposure,
  failures: NativeValidateFailure[],
): void {
  for (const agent of agents) {
    if (agent.name === null || !isAgentExposed(agent, exposure)) {
      continue;
    }

    if (EXPOSED_AGENT_NAME_PATTERN.test(agent.name)) {
      continue;
    }

    failures.push({
      action: `rename agent "${agent.name}" to a URL-safe kebab-case name (lowercase letters, digits, and hyphens, starting with a letter or digit), or remove it from the expose subset`,
      code: "native.agent.name_not_url_safe",
      field: "name",
      file: agent.manifestPath,
      problem: `exposed agent name "${agent.name}" is not a URL-safe path segment for the App API namespace`,
      severity: "error",
    });
  }
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
  agents: readonly DiscoveredAgent[],
  primaryAgent: DiscoveredAgent | null,
  files: Readonly<Record<string, string>>,
): NativeValidateFailure[] {
  const entries = toArchiveEntries(files);
  const failures: NativeValidateFailure[] = [];

  collectMcpSidecarFileFailures(agents, primaryAgent, entries, files, failures);
  collectEnvironmentSidecarFileFailures(agents, primaryAgent, entries, files, failures);

  return failures;
}

function collectMcpSidecarFileFailures(
  agents: readonly DiscoveredAgent[],
  primaryAgent: DiscoveredAgent | null,
  entries: Record<string, Uint8Array>,
  files: Readonly<Record<string, string>>,
  failures: NativeValidateFailure[],
): void {
  const sidecar = parseSidecarJson(files[MCP_SIDECAR_REPO_PATH]);

  if (sidecar.kind === "invalid") {
    failures.push({
      action: `fix the JSON syntax in ${MCP_SIDECAR_REPO_PATH}`,
      code: "native.agent.mcp_invalid",
      file: MCP_SIDECAR_REPO_PATH,
      problem: `${MCP_SIDECAR_REPO_PATH} is not readable as JSON: ${sidecar.message}`,
      severity: "error",
    });
  } else {
    collectPrimaryMcpDelegateFailures(primaryAgent, entries, failures);
  }

  if (sidecar.kind === "absent") {
    return;
  }

  if (sidecar.kind === "parsed") {
    const forbiddenPath = findForbiddenMcpSecretFieldPath(sidecar.value);
    const reported = failures.some(
      (failure) => failure.code === "native.agent.mcp_secret_forbidden",
    );

    if (forbiddenPath !== null && !reported) {
      failures.push({
        action: `remove the plaintext secret from ${MCP_SIDECAR_REPO_PATH}; credentials are connected on the target instance after deploy`,
        code: "native.agent.mcp_secret_forbidden",
        field: forbiddenPath,
        file: MCP_SIDECAR_REPO_PATH,
        problem: `${MCP_SIDECAR_REPO_PATH} must not include secret field ${forbiddenPath}`,
        severity: "error",
      });
    }
  }

  collectMcpReferenceCoverageFailures(agents, sidecar, failures);
}

/**
 * The reused MCP validation is split so every failure lands on the file that
 * contains it: catalog issues (unsupported entry fields and the like) are
 * collected per manifest and attributed to that manifest, while the sidecar
 * pass runs with catalog issues excluded so its output is `.mcp.json`-side
 * only.
 */
function collectPrimaryMcpDelegateFailures(
  primaryAgent: DiscoveredAgent | null,
  entries: Record<string, Uint8Array>,
  failures: NativeValidateFailure[],
): void {
  if (primaryAgent === null || primaryAgent.parsed === null || primaryAgent.hasBlockingIssue) {
    return;
  }

  try {
    for (const issue of collectMcpManifestCatalogIssues(primaryAgent.manifestJson)) {
      failures.push(mapMcpCatalogIssue(issue, primaryAgent.manifestPath));
    }

    const sidecarIssues = collectMcpSidecarIssues(primaryAgent.manifestJson, entries, {
      manifestCatalogIssues: "exclude",
    });

    for (const issue of sidecarIssues) {
      // Undeclared-server coverage is judged natively across all agents.
      if (issue.code === AGENT_PACKAGE_ISSUE_CODES.mcpUndeclared) {
        continue;
      }

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
}

/**
 * Presence-triggered reference coverage for `.agent/.mcp.json`: the sidecar
 * must be referenced by a well-typed mcpServers catalog in at least one agent
 * manifest, and every sidecar server must be declared by some agent (the PRD
 * blesses shared sidecars referenced only from named agent manifests).
 * Skipped while any manifest is unreadable, because the full reference set
 * cannot be known until every manifest parses.
 */
function collectMcpReferenceCoverageFailures(
  agents: readonly DiscoveredAgent[],
  sidecar: SidecarJsonParse,
  failures: NativeValidateFailure[],
): void {
  if (!allManifestsInspectable(agents)) {
    return;
  }

  const hasTypedCatalog = agents.some(
    (agent) => agent.parsed !== null && Array.isArray(agent.parsed["mcpServers"]),
  );

  if (!hasTypedCatalog) {
    failures.push({
      action: `declare each ${MCP_SIDECAR_REPO_PATH} server in an agent manifest mcpServers catalog, or remove ${MCP_SIDECAR_REPO_PATH}`,
      code: "native.agent.mcp_invalid",
      file: MCP_SIDECAR_REPO_PATH,
      problem: `${MCP_SIDECAR_REPO_PATH} exists but no agent manifest declares a mcpServers catalog`,
      severity: "error",
    });
    return;
  }

  if (sidecar.kind !== "parsed" || !isRecord(sidecar.value)) {
    return;
  }

  const sidecarServers = sidecar.value["mcpServers"];

  if (!isRecord(sidecarServers)) {
    return;
  }

  const referencedNames = new Set(
    agents.flatMap((agent) =>
      agent.parsed === null ? [] : readMcpCatalogReferencedNames(agent.parsed),
    ),
  );

  for (const serverName of Object.keys(sidecarServers).toSorted()) {
    if (referencedNames.has(serverName)) {
      continue;
    }

    failures.push({
      action: `declare MCP server "${serverName}" in an agent manifest mcpServers catalog, or remove it from ${MCP_SIDECAR_REPO_PATH}`,
      code: "native.agent.mcp_invalid",
      file: MCP_SIDECAR_REPO_PATH,
      problem: `MCP server "${serverName}" in ${MCP_SIDECAR_REPO_PATH} is not declared by any agent manifest`,
      severity: "error",
    });
  }
}

function collectEnvironmentSidecarFileFailures(
  agents: readonly DiscoveredAgent[],
  primaryAgent: DiscoveredAgent | null,
  entries: Record<string, Uint8Array>,
  files: Readonly<Record<string, string>>,
  failures: NativeValidateFailure[],
): void {
  const sidecar = parseSidecarJson(files[ENVIRONMENT_DEFINITION_REPO_PATH]);

  if (sidecar.kind === "invalid") {
    failures.push({
      action: `fix the JSON syntax in ${ENVIRONMENT_DEFINITION_REPO_PATH}`,
      code: "native.agent.environment_invalid",
      file: ENVIRONMENT_DEFINITION_REPO_PATH,
      problem: `${ENVIRONMENT_DEFINITION_REPO_PATH} is not readable as JSON: ${sidecar.message}`,
      severity: "error",
    });
  } else {
    collectPrimaryEnvironmentDelegateFailures(primaryAgent, entries, failures);
  }

  if (sidecar.kind === "absent") {
    return;
  }

  if (sidecar.kind === "parsed") {
    const forbiddenPath = findForbiddenEnvironmentSidecarFieldPath(sidecar.value);
    const reported = failures.some(
      (failure) => failure.code === "native.agent.environment_secret_forbidden",
    );

    if (forbiddenPath !== null && !reported) {
      failures.push({
        action: `remove the plaintext secret from ${ENVIRONMENT_DEFINITION_REPO_PATH} and declare the name in secretNames instead`,
        code: "native.agent.environment_secret_forbidden",
        field: forbiddenPath,
        file: ENVIRONMENT_DEFINITION_REPO_PATH,
        problem: `${ENVIRONMENT_DEFINITION_REPO_PATH} must not include secret field ${forbiddenPath}`,
        severity: "error",
      });
    }
  }

  if (!allManifestsInspectable(agents) || agents.some(hasTypedEnvironmentReference)) {
    return;
  }

  failures.push({
    action: `set environment.ref to "${ENVIRONMENT_DEFINITION_ARCHIVE_PATH}" in an agent manifest, or remove ${ENVIRONMENT_DEFINITION_REPO_PATH}`,
    code: "native.agent.environment_invalid",
    file: ENVIRONMENT_DEFINITION_REPO_PATH,
    problem: `${ENVIRONMENT_DEFINITION_REPO_PATH} exists but no agent manifest references it via environment.ref`,
    severity: "error",
  });
}

function collectPrimaryEnvironmentDelegateFailures(
  primaryAgent: DiscoveredAgent | null,
  entries: Record<string, Uint8Array>,
  failures: NativeValidateFailure[],
): void {
  if (primaryAgent === null || primaryAgent.parsed === null || primaryAgent.hasBlockingIssue) {
    return;
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
}

function allManifestsInspectable(agents: readonly DiscoveredAgent[]): boolean {
  return agents.every((agent) => agent.parsed !== null);
}

/**
 * A manifest reference counts as well-typed when environment is a record and
 * ref is a string; non-canonical string refs are rejected separately by the
 * reused package validation (`package.environment.ref.unsupported`).
 */
function hasTypedEnvironmentReference(agent: DiscoveredAgent): boolean {
  if (agent.parsed === null) {
    return false;
  }

  const environment = agent.parsed["environment"];

  return isRecord(environment) && typeof environment["ref"] === "string";
}

function mapMcpCatalogIssue(
  issue: AgentResolutionIssue,
  manifestPath: string,
): NativeValidateFailure {
  return {
    action: `update the mcpServers catalog in ${manifestPath} so it passes package validation`,
    code: "native.agent.mcp_invalid",
    file: manifestPath,
    problem: `${issue.message} (${issue.code})`,
    severity: issue.severity === "error" ? "error" : "warning",
  };
}

/** Maps sidecar-side issues only; catalog issues are excluded at collection. */
function mapMcpSidecarIssue(issue: AgentResolutionIssue): NativeValidateFailure {
  if (issue.code === AGENT_PACKAGE_ISSUE_CODES.mcpSecretForbidden) {
    return {
      action: `remove the plaintext secret from ${MCP_SIDECAR_REPO_PATH}; credentials are connected on the target instance after deploy`,
      code: "native.agent.mcp_secret_forbidden",
      file: MCP_SIDECAR_REPO_PATH,
      problem: `${issue.message} (${issue.code})`,
      severity: "error",
    };
  }

  return {
    action: `update ${MCP_SIDECAR_REPO_PATH} so the MCP sidecar passes package validation`,
    code: "native.agent.mcp_invalid",
    file: MCP_SIDECAR_REPO_PATH,
    problem: `${issue.message} (${issue.code})`,
    severity: issue.severity === "error" ? "error" : "warning",
  };
}

function mapEnvironmentSidecarIssue(issue: AgentResolutionIssue): NativeValidateFailure {
  if (issue.code === AGENT_PACKAGE_ISSUE_CODES.environmentSecretForbidden) {
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
    ...(issue.code === AGENT_PACKAGE_ISSUE_CODES.environmentFieldUnsupported &&
    issue.targetLabel !== null
      ? { field: issue.targetLabel }
      : {}),
    file: ENVIRONMENT_DEFINITION_REPO_PATH,
    problem: `${issue.message} (${issue.code})`,
    severity: issue.severity === "error" ? "error" : "warning",
  };
}

function deriveSetupFailures(
  agents: readonly DiscoveredAgent[],
  files: Readonly<Record<string, string>>,
): NativeValidateFailure[] {
  const manifests = agents.flatMap((agent) => (agent.parsed === null ? [] : [agent.parsed]));

  if (manifests.length === 0) {
    return [];
  }

  const failures: NativeValidateFailure[] = [];
  const mcpSource = files[MCP_SIDECAR_REPO_PATH];
  const catalogNames = [
    ...new Set(manifests.flatMap((manifest) => readMcpCatalogNames(manifest))),
  ].toSorted();

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
  const definitionReferenced = manifests.some(
    (manifest) => readEnvironmentRef(manifest) === ENVIRONMENT_DEFINITION_ARCHIVE_PATH,
  );

  if (!definitionReferenced || definitionSource === undefined) {
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

/**
 * Server names referenced by a manifest's mcpServers catalog via
 * `.mcp.json#<name>` refs, mirroring the reused sidecar validator's labeling
 * (catalog `name` wins over the ref suffix when both are present).
 */
function readMcpCatalogReferencedNames(manifest: Readonly<Record<string, unknown>>): string[] {
  const catalog = manifest["mcpServers"];

  if (!Array.isArray(catalog)) {
    return [];
  }

  const refPrefix = `${MCP_SIDECAR_ARCHIVE_PATH}#`;
  const names: string[] = [];

  for (const entry of catalog) {
    if (!isRecord(entry)) {
      continue;
    }

    const name = typeof entry["name"] === "string" ? entry["name"] : null;
    const ref = typeof entry["ref"] === "string" ? entry["ref"] : null;

    if (ref === null || !ref.startsWith(refPrefix)) {
      continue;
    }

    names.push(name ?? ref.slice(refPrefix.length));
  }

  return names;
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

function parseSidecarJson(source: string | undefined): SidecarJsonParse {
  if (source === undefined) {
    return { kind: "absent" };
  }

  try {
    return { kind: "parsed", value: JSON.parse(source) };
  } catch (error) {
    return { kind: "invalid", message: errorMessage(error) };
  }
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

/**
 * Excludes Date so TOML datetime scalars (smol-toml `TomlDate extends Date`)
 * are rejected where tables are required instead of passing as empty records.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}
