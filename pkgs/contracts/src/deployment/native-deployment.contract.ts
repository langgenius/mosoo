/**
 * Mosoo Native Deployment Protocol v1 — validate contract.
 *
 * Single source of truth: docs/prd/mosoo-native-deployment-protocol.md
 * (Validator Contract). `validate` reports doctor-style versioned JSON with
 * machine-stable failure codes so coding agents can repair repos mechanically.
 *
 * Mapping rule (deliberate one-way door): underlying `manifest.*` /
 * `package.*` issue codes from the reused agent package validation are never
 * exposed as validate codes; they map into the closed `native.*` set below,
 * carrying specifics in `field` / `problem`.
 */

export const MOSOO_NATIVE_SPEC = "mosoo.spec.v1" as const;
export const NATIVE_VALIDATE_SCHEMA_VERSION = 1 as const;

/** Root repo marker declaring a Mosoo Native Deployable. */
export const NATIVE_TOML_PATH = ".mosoo.toml" as const;

/**
 * Agent definition surface.
 * Primary manifest: `.agent/manifest.json`.
 * Named agents: `.agent/agents/<dir>/manifest.json`.
 * Shared sidecars: `.agent/.mcp.json`, `.agent/environment/definition.json`.
 */
export const NATIVE_AGENT_DIR = ".agent" as const;

/**
 * Closed set of validate failure codes, sorted ascending. The codes are a
 * public machine-stable contract: renames or removals are breaking changes.
 *
 * Severity is `error` unless noted:
 * - warning: `native.agent.manifest_warning`, `native.expose.none`,
 *   `native.toml.unknown_key`
 * - setup_required: `native.setup.environment_secret`,
 *   `native.setup.mcp_reconnect`
 */
export const NATIVE_VALIDATE_FAILURE_CODES = [
  "native.agent.dir_name_mismatch",
  "native.agent.environment_invalid",
  "native.agent.environment_secret_forbidden",
  "native.agent.invalid_path",
  "native.agent.manifest_invalid",
  "native.agent.manifest_missing",
  "native.agent.manifest_parse_error",
  "native.agent.manifest_warning",
  "native.agent.mcp_invalid",
  "native.agent.mcp_secret_forbidden",
  "native.agent.name_conflict",
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
] as const;

export type NativeValidateFailureCode = (typeof NATIVE_VALIDATE_FAILURE_CODES)[number];

export type NativeValidateSeverity = "error" | "setup_required" | "warning";

export interface NativeValidateFailure {
  /** Repairable instruction in repo terms. */
  action: string;
  code: NativeValidateFailureCode;
  /** Dotted field path when known; the key is omitted when unknown. */
  field?: string;
  /** Repo-relative path in repo terms, e.g. ".agent/manifest.json". */
  file: string;
  /** Why the current value is illegal. */
  problem: string;
  severity: NativeValidateSeverity;
}

export interface NativeValidateAgentFact {
  exposed: boolean;
  name: string;
  source: "named" | "primary";
}

export interface NativeValidateFacts {
  agentCount: number;
  agents: NativeValidateAgentFact[];
  spec: typeof MOSOO_NATIVE_SPEC;
  web: {
    /** Resolved target agent name when known; the key is omitted otherwise. */
    agent?: string;
    declared: boolean;
  };
}

export interface NativeValidateResult {
  /** Null when the marker is missing, unparseable, or the spec is invalid. */
  facts: NativeValidateFacts | null;
  failures: NativeValidateFailure[];
  schemaVersion: typeof NATIVE_VALIDATE_SCHEMA_VERSION;
  /** True when no error-severity failures were produced. */
  valid: boolean;
}
