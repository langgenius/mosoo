/**
 * Mosoo Native Deployment Protocol v1 — deployment run result.
 *
 * Single source of truth: docs/prd/mosoo-native-deployment-protocol.md
 * (Deployment Semantics). A protocol deploy persists one
 * {@link NativeDeploymentRunResult} on the run row (`native_result_json`):
 * the Phase 0 validate report immediately after validation, then provisioning
 * facts once agents were upserted. The frontend failure expansion and the run
 * facts card render straight from this JSON, so the shape is a committed
 * contract like the validate result it embeds.
 *
 * Parsing is collect-don't-throw: `parseNativeDeploymentRunResult` never
 * throws and returns `null` for anything that is not a well-formed serialized
 * result (unknown codes, wrong primitive types, truncated JSON). Stored rows
 * are only ever written through `serializeNativeDeploymentRunResult`, so a
 * `null` parse means the row predates the contract or was corrupted — callers
 * treat it as "no native result".
 */
import {
  MOSOO_NATIVE_SPEC,
  NATIVE_VALIDATE_FAILURE_CODES,
  NATIVE_VALIDATE_SCHEMA_VERSION,
} from "./native-deployment.contract";
import type {
  NativeValidateAgentFact,
  NativeValidateFacts,
  NativeValidateFailure,
  NativeValidateResult,
  NativeValidateSeverity,
} from "./native-deployment.contract";

/**
 * Closed set of run-level error codes for the protocol deploy path, sorted
 * ascending. Flat snake_case per the deploy-path dialect (`run.errorCode`),
 * unlike the dotted `native.*` codes inside the embedded validate JSON.
 */
export const NATIVE_RUN_ERROR_CODES = [
  "native_agent_name_ambiguous",
  "native_provision_failed",
  "native_setup_required",
  "native_validation_failed",
  "native_web_static_unsupported",
] as const;

export type NativeRunErrorCode = (typeof NATIVE_RUN_ERROR_CODES)[number];

/** Per-agent outcome of the upsert step of a protocol deploy. */
export type NativeAgentProvisionAction = "created" | "failed" | "unchanged" | "updated";

export interface NativeDeploymentRunAgentFact {
  action: NativeAgentProvisionAction;
  /** True when the agent is in the repo's expose subset. */
  exposed: boolean;
  name: string;
  /** Minted DeploymentVersion number; the key is omitted when none was minted. */
  versionNumber?: number;
}

/** Provisioning facts recorded after the agent upsert step ran. */
export interface NativeDeploymentRunFacts {
  agentCount: number;
  agents: NativeDeploymentRunAgentFact[];
  /** Protocol spec string from `.mosoo.toml`, e.g. "mosoo.spec.v1". */
  specVersion: string;
  web: {
    /** Resolved web-bound agent name when known; the key is omitted otherwise. */
    agent?: string;
    declared: boolean;
  };
}

export interface NativeDeploymentRunResult {
  /** Null until agent provisioning has produced per-agent outcomes. */
  facts: NativeDeploymentRunFacts | null;
  validate: NativeValidateResult;
}

const NATIVE_AGENT_PROVISION_ACTION_VALUES = [
  "created",
  "failed",
  "unchanged",
  "updated",
] as const satisfies readonly NativeAgentProvisionAction[];

const NATIVE_VALIDATE_SEVERITY_VALUES = [
  "error",
  "setup_required",
  "warning",
] as const satisfies readonly NativeValidateSeverity[];

const NATIVE_VALIDATE_AGENT_SOURCE_VALUES = [
  "named",
  "primary",
] as const satisfies readonly NativeValidateAgentFact["source"][];

const NATIVE_RUN_AGENT_ACTION_SET: ReadonlySet<string> = new Set(
  NATIVE_AGENT_PROVISION_ACTION_VALUES,
);
const NATIVE_VALIDATE_FAILURE_CODE_SET: ReadonlySet<string> = new Set(
  NATIVE_VALIDATE_FAILURE_CODES,
);
const NATIVE_VALIDATE_SEVERITY_SET: ReadonlySet<string> = new Set(NATIVE_VALIDATE_SEVERITY_VALUES);
const NATIVE_VALIDATE_AGENT_SOURCE_SET: ReadonlySet<string> = new Set(
  NATIVE_VALIDATE_AGENT_SOURCE_VALUES,
);

export function serializeNativeDeploymentRunResult(result: NativeDeploymentRunResult): string {
  return JSON.stringify(result);
}

/**
 * Parses a serialized {@link NativeDeploymentRunResult}. Never throws; returns
 * `null` when the input is `null`, is not valid JSON, or does not match the
 * contract shape. Unknown keys are dropped; the returned objects carry exactly
 * the contract fields.
 */
export function parseNativeDeploymentRunResult(
  json: string | null,
): NativeDeploymentRunResult | null {
  if (json === null) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const validate = parseValidateResult(parsed["validate"]);

  if (validate === null) {
    return null;
  }

  const factsValue = parsed["facts"];

  if (factsValue === null || factsValue === undefined) {
    return { facts: null, validate };
  }

  const facts = parseRunFacts(factsValue);

  if (facts === null) {
    return null;
  }

  return { facts, validate };
}

function parseValidateResult(value: unknown): NativeValidateResult | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value["schemaVersion"] !== NATIVE_VALIDATE_SCHEMA_VERSION) {
    return null;
  }

  const valid = value["valid"];
  const failuresValue = value["failures"];

  if (typeof valid !== "boolean" || !Array.isArray(failuresValue)) {
    return null;
  }

  const failures: NativeValidateFailure[] = [];

  for (const failureValue of failuresValue) {
    const failure = parseValidateFailure(failureValue);

    if (failure === null) {
      return null;
    }

    failures.push(failure);
  }

  const factsValue = value["facts"];

  if (factsValue === null || factsValue === undefined) {
    return { facts: null, failures, schemaVersion: NATIVE_VALIDATE_SCHEMA_VERSION, valid };
  }

  const facts = parseValidateFacts(factsValue);

  if (facts === null) {
    return null;
  }

  return { facts, failures, schemaVersion: NATIVE_VALIDATE_SCHEMA_VERSION, valid };
}

function parseValidateFailure(value: unknown): NativeValidateFailure | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = value["action"];
  const code = value["code"];
  const field = value["field"];
  const file = value["file"];
  const problem = value["problem"];
  const severity = value["severity"];

  if (
    typeof action !== "string" ||
    typeof code !== "string" ||
    !NATIVE_VALIDATE_FAILURE_CODE_SET.has(code) ||
    typeof file !== "string" ||
    typeof problem !== "string" ||
    typeof severity !== "string" ||
    !NATIVE_VALIDATE_SEVERITY_SET.has(severity)
  ) {
    return null;
  }

  if (field !== undefined && typeof field !== "string") {
    return null;
  }

  return {
    action,
    code: code as NativeValidateFailure["code"],
    ...(field === undefined ? {} : { field }),
    file,
    problem,
    severity: severity as NativeValidateSeverity,
  };
}

function parseValidateFacts(value: unknown): NativeValidateFacts | null {
  if (!isRecord(value)) {
    return null;
  }

  const agentCount = value["agentCount"];
  const agentsValue = value["agents"];
  const spec = value["spec"];

  if (typeof agentCount !== "number" || !Array.isArray(agentsValue) || spec !== MOSOO_NATIVE_SPEC) {
    return null;
  }

  const agents: NativeValidateAgentFact[] = [];

  for (const agentValue of agentsValue) {
    if (!isRecord(agentValue)) {
      return null;
    }

    const exposed = agentValue["exposed"];
    const name = agentValue["name"];
    const source = agentValue["source"];

    if (
      typeof exposed !== "boolean" ||
      typeof name !== "string" ||
      typeof source !== "string" ||
      !NATIVE_VALIDATE_AGENT_SOURCE_SET.has(source)
    ) {
      return null;
    }

    agents.push({ exposed, name, source: source as NativeValidateAgentFact["source"] });
  }

  const web = parseValidateWebFact(value["web"]);

  if (web === null) {
    return null;
  }

  return { agentCount, agents, spec: MOSOO_NATIVE_SPEC, web };
}

function parseRunFacts(value: unknown): NativeDeploymentRunFacts | null {
  if (!isRecord(value)) {
    return null;
  }

  const agentCount = value["agentCount"];
  const agentsValue = value["agents"];
  const specVersion = value["specVersion"];

  if (
    typeof agentCount !== "number" ||
    !Array.isArray(agentsValue) ||
    typeof specVersion !== "string"
  ) {
    return null;
  }

  const agents: NativeDeploymentRunAgentFact[] = [];

  for (const agentValue of agentsValue) {
    const agent = parseRunAgentFact(agentValue);

    if (agent === null) {
      return null;
    }

    agents.push(agent);
  }

  const web = parseWebFact(value["web"]);

  if (web === null) {
    return null;
  }

  return { agentCount, agents, specVersion, web };
}

function parseRunAgentFact(value: unknown): NativeDeploymentRunAgentFact | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = value["action"];
  const exposed = value["exposed"];
  const name = value["name"];
  const versionNumber = value["versionNumber"];

  if (
    typeof action !== "string" ||
    !NATIVE_RUN_AGENT_ACTION_SET.has(action) ||
    typeof exposed !== "boolean" ||
    typeof name !== "string"
  ) {
    return null;
  }

  if (versionNumber !== undefined && typeof versionNumber !== "number") {
    return null;
  }

  return {
    action: action as NativeAgentProvisionAction,
    exposed,
    name,
    ...(versionNumber === undefined ? {} : { versionNumber }),
  };
}

function parseWebFact(value: unknown): NativeDeploymentRunFacts["web"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const agent = value["agent"];
  const declared = value["declared"];

  if (typeof declared !== "boolean") {
    return null;
  }

  if (agent !== undefined && typeof agent !== "string") {
    return null;
  }

  return { ...(agent === undefined ? {} : { agent }), declared };
}

/**
 * Validate facts carry the extra `[expose.web] build` override the executor
 * uses to override the detected build command, so this preserves it while the
 * run-level web fact (`parseWebFact`) intentionally does not.
 */
function parseValidateWebFact(value: unknown): NativeValidateFacts["web"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const agent = value["agent"];
  const build = value["build"];
  const declared = value["declared"];

  if (typeof declared !== "boolean") {
    return null;
  }

  if (agent !== undefined && typeof agent !== "string") {
    return null;
  }

  if (build !== undefined && typeof build !== "string") {
    return null;
  }

  return {
    ...(agent === undefined ? {} : { agent }),
    ...(build === undefined ? {} : { build }),
    declared,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
