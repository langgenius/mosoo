import { AGENT_PACKAGE_ISSUE_CODES } from "@mosoo/contracts/agent-manifest";
import type {
  AgentManifestEnvironmentReference,
  AgentPackage,
  AgentResolutionIssue,
} from "@mosoo/contracts/agent-manifest";

import { readArchiveBytes, readArchiveJson } from "./archive-bytes";
import { ENVIRONMENT_DEFINITION_PATH } from "./archive-constants";
import { createArchiveIssue } from "./archive-issue";

const ENVIRONMENT_SIDECAR_FIELDS = new Set(["expectedName", "secretNames", "setupScript"]);
const ENVIRONMENT_SIDECAR_FORBIDDEN_SECRET_FIELDS = new Set([
  "access_token",
  "accesstoken",
  "api_key",
  "apikey",
  "authorization",
  "bearer_token",
  "bearertoken",
  "client_secret",
  "clientsecret",
  "credential",
  "credential_id",
  "credentialid",
  "credentials",
  "env",
  "env_vars",
  "envvars",
  "headers",
  "lookup_key",
  "lookupkey",
  "oauth_client_secret",
  "oauthclientsecret",
  "password",
  "refresh_token",
  "refreshtoken",
  "secret",
  "secret_id",
  "secret_value",
  "secret_values",
  "secretid",
  "secretvalue",
  "secretvalues",
  "source_credential_id",
  "sourcecredentialid",
  "token",
  "vault",
  "vault_locator",
  "vaultlocator",
]);

export function attachEnvironmentDefinition(
  agentPackage: AgentPackage,
  manifestJson: string,
  entries: Record<string, Uint8Array>,
): AgentPackage {
  if (readEnvironmentDefinitionRef(manifestJson) !== ENVIRONMENT_DEFINITION_PATH) {
    return agentPackage;
  }

  const environment = readEnvironmentDefinition(entries);

  if (environment === null) {
    return agentPackage;
  }

  return {
    ...agentPackage,
    manifest: {
      ...agentPackage.manifest,
      environment,
    },
  };
}

export function collectEnvironmentSidecarIssues(
  manifestJson: string,
  entries: Record<string, Uint8Array>,
): AgentResolutionIssue[] {
  const environmentRef = readEnvironmentDefinitionRef(manifestJson);

  if (environmentRef !== ENVIRONMENT_DEFINITION_PATH) {
    return [];
  }

  if (readArchiveBytes(entries, ENVIRONMENT_DEFINITION_PATH) === null) {
    return [
      createArchiveIssue({
        code: AGENT_PACKAGE_ISSUE_CODES.environmentMissing,
        message: "Agent package environment ref requires environment/definition.json.",
        status: "unsupported",
        targetLabel: ENVIRONMENT_DEFINITION_PATH,
        targetType: "environment",
      }),
    ];
  }

  const environmentDefinition = readArchiveJson(entries, ENVIRONMENT_DEFINITION_PATH);

  if (!isRecord(environmentDefinition)) {
    return [
      createArchiveIssue({
        code: AGENT_PACKAGE_ISSUE_CODES.environmentInvalid,
        message: "Agent package environment/definition.json must be a JSON object.",
        status: "unsupported",
        targetLabel: ENVIRONMENT_DEFINITION_PATH,
        targetType: "environment",
      }),
    ];
  }

  const issues: AgentResolutionIssue[] = [];

  for (const field of Object.keys(environmentDefinition)) {
    if (!ENVIRONMENT_SIDECAR_FIELDS.has(field)) {
      issues.push(
        createArchiveIssue({
          code: AGENT_PACKAGE_ISSUE_CODES.environmentFieldUnsupported,
          message: `Environment definition field ${field} is not supported in V1 Agent packages.`,
          status: "unsupported",
          targetLabel: field,
          targetType: "environment",
        }),
      );
    }
  }

  const forbiddenSecretField = findForbiddenEnvironmentSidecarFieldPath(environmentDefinition);

  if (forbiddenSecretField !== null) {
    issues.push(
      createArchiveIssue({
        code: AGENT_PACKAGE_ISSUE_CODES.environmentSecretForbidden,
        message: `Environment definition must not include secret field ${forbiddenSecretField}.`,
        status: "unsupported",
        targetLabel: forbiddenSecretField,
        targetType: "environment",
      }),
    );
  }

  return issues;
}

function readEnvironmentDefinition(
  entries: Record<string, Uint8Array>,
): AgentManifestEnvironmentReference | null {
  const environmentDefinition = readArchiveJson(entries, ENVIRONMENT_DEFINITION_PATH);

  if (!isRecord(environmentDefinition)) {
    return null;
  }

  const secretNames = Array.isArray(environmentDefinition["secretNames"])
    ? environmentDefinition["secretNames"]
    : [];
  const envVars: Record<string, string> = {};

  for (const secretName of secretNames) {
    if (typeof secretName === "string" && secretName.length > 0) {
      envVars[secretName] = "";
    }
  }

  return {
    environmentId: null,
    envVars,
    expectedName:
      typeof environmentDefinition["expectedName"] === "string"
        ? environmentDefinition["expectedName"]
        : null,
    setupScript:
      typeof environmentDefinition["setupScript"] === "string"
        ? environmentDefinition["setupScript"]
        : "",
  };
}

function readEnvironmentDefinitionRef(manifestJson: string): string | null {
  const parsedManifest: unknown = JSON.parse(manifestJson);

  if (!isRecord(parsedManifest)) {
    return null;
  }

  return readEnvironmentDefinitionRefFromManifest(parsedManifest);
}

function readEnvironmentDefinitionRefFromManifest(
  manifest: Record<string, unknown>,
): string | null {
  const environment = manifest["environment"];

  if (!isRecord(environment)) {
    return null;
  }

  const ref = environment["ref"];

  return typeof ref === "string" ? ref : null;
}

export function findForbiddenEnvironmentSidecarFieldPath(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenEnvironmentSidecarFieldPath(value[index], `${path}[${index}]`);

      if (match !== null) {
        return match;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const childPath = path.length > 0 ? `${path}.${key}` : key;
    const normalizedKey = key.toLowerCase().replaceAll("-", "_");

    if (
      normalizedKey !== "secretnames" &&
      ENVIRONMENT_SIDECAR_FORBIDDEN_SECRET_FIELDS.has(normalizedKey)
    ) {
      return childPath;
    }

    const match = findForbiddenEnvironmentSidecarFieldPath(childValue, childPath);

    if (match !== null) {
      return match;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
