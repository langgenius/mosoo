import {
  createValidationIssue,
  hasRequiredText,
  isRecord,
  readAgentKind,
  readRecordField,
  readString,
} from "./agent-manifest-parser-internals.contract";
import { AGENT_MANIFEST_VERSION, AGENT_PACKAGE_VERSION } from "./agent-manifest-version.contract";
import { AGENT_PACKAGE_ISSUE_CODES } from "./agent-manifest.contract";
import type { AgentResolutionIssue } from "./agent-manifest.contract";
import { AGENT_KIND_LIST_LABEL } from "./agent.contract";

const PACKAGE_MANIFEST_TOP_LEVEL_FIELDS = new Set([
  "author",
  "avatar",
  "builtInTools",
  "description",
  "environment",
  "exportedAt",
  "kind",
  "license",
  "manifestVersion",
  "mcpServers",
  "model",
  "name",
  "packageVersion",
  "prompts",
  "provider",
  "providerOptions",
  "runtime",
  "settings",
  "skills",
  "sourceAgentId",
  "version",
]);

const PACKAGE_MANIFEST_FORBIDDEN_FIELDS = new Set([
  "channels",
  "cost",
  "credentials",
  "dependencies",
  "logs",
  "runtimeState",
  "secrets",
  "sessions",
  "sourceOrgId",
  "sourceOrganizationId",
  "sourceProvenance",
]);

const PACKAGE_MANIFEST_FORBIDDEN_SECRET_FIELDS = new Set([
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
  "secretid",
  "secret_values",
  "secretvalues",
  "source_credential_id",
  "sourcecredentialid",
  "token",
  "vault",
  "vault_locator",
  "vaultlocator",
]);

const MCP_SIDECAR_REF_PREFIX = ".mcp.json#";
const PACKAGE_ENVIRONMENT_CATALOG_FIELDS = new Set(["ref"]);

export function createPackageIssue(
  code: string,
  message: string,
  status?: "unsupported",
): AgentResolutionIssue {
  if (status === undefined) {
    return createValidationIssue({
      code,
      message,
      targetType: "agent",
    });
  }

  return createValidationIssue({
    code,
    message,
    status,
    targetType: "agent",
  });
}

export function collectPackageIssues(input: Record<string, unknown>): AgentResolutionIssue[] {
  const issues: AgentResolutionIssue[] = [];
  const kind = readAgentKind(input["kind"]);
  const runtime = readString(input, "runtime");
  const provider = readString(input, "provider");
  const model = readString(input, "model");
  const prompts = readRecordField(input, "prompts");
  const systemPrompt = readString(prompts, "system");
  const name = readString(input, "name");

  if (input["packageVersion"] !== AGENT_PACKAGE_VERSION) {
    issues.push(
      createPackageIssue(
        AGENT_PACKAGE_ISSUE_CODES.packageVersionUnsupported,
        `Agent Package version must be ${AGENT_PACKAGE_VERSION}.`,
        "unsupported",
      ),
    );
  }

  for (const field of Object.keys(input)) {
    if (PACKAGE_MANIFEST_FORBIDDEN_FIELDS.has(field)) {
      issues.push(
        createPackageIssue(
          AGENT_PACKAGE_ISSUE_CODES.fieldForbidden,
          `Agent package manifest must not include ${field}.`,
          "unsupported",
        ),
      );
      continue;
    }

    if (!PACKAGE_MANIFEST_TOP_LEVEL_FIELDS.has(field)) {
      issues.push(
        createPackageIssue(
          AGENT_PACKAGE_ISSUE_CODES.fieldUnsupported,
          `Agent package manifest field ${field} is not supported in V1.`,
          "unsupported",
        ),
      );
    }
  }

  const forbiddenSecretPath = findForbiddenPackageSecretFieldPath(input);

  if (forbiddenSecretPath !== null) {
    issues.push(
      createPackageIssue(
        AGENT_PACKAGE_ISSUE_CODES.packageSecretForbidden,
        `Agent package manifest must not include secret field ${forbiddenSecretPath}.`,
        "unsupported",
      ),
    );
  }

  if (input["manifestVersion"] !== AGENT_MANIFEST_VERSION) {
    issues.push(
      createPackageIssue(
        AGENT_PACKAGE_ISSUE_CODES.manifestVersionUnsupported,
        `Agent Manifest version must be ${AGENT_MANIFEST_VERSION}.`,
        "unsupported",
      ),
    );
  }

  issues.push(...collectMcpCatalogIssues(input["mcpServers"]));
  issues.push(...collectEnvironmentCatalogIssues(input["environment"]));

  if (kind === null) {
    issues.push(
      createPackageIssue(
        AGENT_PACKAGE_ISSUE_CODES.manifestKindMissing,
        `Agent Manifest kind must be ${AGENT_KIND_LIST_LABEL}.`,
      ),
    );
  }

  if (!hasRequiredText(name)) {
    issues.push(
      createPackageIssue(
        AGENT_PACKAGE_ISSUE_CODES.manifestNameMissing,
        "Manifest name is required.",
      ),
    );
  }

  if (!hasRequiredText(runtime)) {
    issues.push(
      createPackageIssue(
        AGENT_PACKAGE_ISSUE_CODES.manifestRuntimeMissing,
        "Manifest runtime is required.",
      ),
    );
  }

  if (!hasRequiredText(provider) || !hasRequiredText(model)) {
    issues.push(
      createPackageIssue(
        AGENT_PACKAGE_ISSUE_CODES.manifestModelMissing,
        "Manifest provider and model are required.",
      ),
    );
  }

  if (systemPrompt === null) {
    issues.push(
      createPackageIssue(
        AGENT_PACKAGE_ISSUE_CODES.manifestPromptMissing,
        "Manifest prompts.system is required.",
      ),
    );
  }

  return issues;
}

export function hasBlockingPackageIssue(issues: AgentResolutionIssue[]): boolean {
  return issues.some(
    (issue) =>
      issue.status === "unsupported" ||
      issue.code === AGENT_PACKAGE_ISSUE_CODES.manifestKindMissing ||
      issue.code === AGENT_PACKAGE_ISSUE_CODES.manifestNameMissing ||
      issue.code === AGENT_PACKAGE_ISSUE_CODES.manifestRuntimeMissing ||
      issue.code === AGENT_PACKAGE_ISSUE_CODES.manifestModelMissing ||
      issue.code === AGENT_PACKAGE_ISSUE_CODES.manifestPromptMissing,
  );
}

function collectEnvironmentCatalogIssues(value: unknown): AgentResolutionIssue[] {
  if (!isRecord(value)) {
    return [];
  }

  const issues: AgentResolutionIssue[] = [];

  for (const field of Object.keys(value)) {
    if (!PACKAGE_ENVIRONMENT_CATALOG_FIELDS.has(field)) {
      issues.push(
        createPackageIssue(
          AGENT_PACKAGE_ISSUE_CODES.environmentFieldUnsupported,
          `Environment catalog field ${field} is not supported in Agent packages.`,
          "unsupported",
        ),
      );
    }
  }

  const ref = readString(value, "ref");

  if (ref !== null && ref !== "environment/definition.json") {
    issues.push(
      createPackageIssue(
        AGENT_PACKAGE_ISSUE_CODES.environmentRefUnsupported,
        "Environment catalog ref must be environment/definition.json.",
        "unsupported",
      ),
    );
  }

  return issues;
}

function collectMcpCatalogIssues(value: unknown): AgentResolutionIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const issues: AgentResolutionIssue[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const name = readString(entry, "name");
    const ref = readString(entry, "ref");

    if (!hasRequiredText(name)) {
      issues.push(
        createPackageIssue(
          AGENT_PACKAGE_ISSUE_CODES.mcpNameMissing,
          "MCP server package declaration must include a name.",
          "unsupported",
        ),
      );
    }

    if (ref === null || !ref.startsWith(MCP_SIDECAR_REF_PREFIX)) {
      issues.push(
        createPackageIssue(
          AGENT_PACKAGE_ISSUE_CODES.mcpRefMissing,
          `MCP server ${name ?? "(unknown)"} must reference .mcp.json instead of inline connection fields.`,
          "unsupported",
        ),
      );
      continue;
    }

    const refName = ref.slice(MCP_SIDECAR_REF_PREFIX.length);

    if (hasRequiredText(name) && refName !== name) {
      issues.push(
        createPackageIssue(
          AGENT_PACKAGE_ISSUE_CODES.mcpRefMismatch,
          `MCP server ${name} must use ref .mcp.json#${name}.`,
          "unsupported",
        ),
      );
    }
  }

  return issues;
}

function findForbiddenPackageSecretFieldPath(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenPackageSecretFieldPath(value[index], `${path}[${index}]`);

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
    const normalizedKey = key.toLowerCase().replaceAll("-", "_");
    const childPath = path.length > 0 ? `${path}.${key}` : key;

    if (PACKAGE_MANIFEST_FORBIDDEN_SECRET_FIELDS.has(normalizedKey)) {
      return childPath;
    }

    const match = findForbiddenPackageSecretFieldPath(childValue, childPath);

    if (match !== null) {
      return match;
    }
  }

  return null;
}
