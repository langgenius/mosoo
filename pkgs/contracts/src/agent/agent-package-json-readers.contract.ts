import { parseJsonObject } from "../validation/primitives.contract";
import {
  hasRequiredText,
  isRecord,
  readBuiltInToolConfig,
  readAgentKind,
  readBooleanOrDefault,
  readNullableString,
  readParsedArray,
  readJsonObjectField,
  readRecordField,
  readString,
} from "./agent-manifest-parser-internals.contract";
import { AGENT_MANIFEST_VERSION, AGENT_PACKAGE_VERSION } from "./agent-manifest-version.contract";
import type {
  AgentManifest,
  AgentManifestMcpServerBinding,
  AgentManifestSkillReference,
  AgentPackage,
} from "./agent-manifest.contract";
import { normalizeAgentBuiltInTools } from "./agent.contract";

export function readAgentPackageFromRecord(
  input: Record<string, unknown>,
  manifest: AgentManifest,
): AgentPackage {
  return {
    app: {
      avatarAssetKey: readNullableStringFromUnknown(input["avatar"]),
      description: readNullableString(input, "description"),
      name: readString(input, "name") ?? manifest.metadata.name,
    },
    assets: [],
    author: readAuthor(input["author"]),
    exportedAt: readString(input, "exportedAt") ?? new Date(0).toISOString(),
    license: readNullableString(input, "license"),
    manifest,
    packageVersion: AGENT_PACKAGE_VERSION,
    sourceAgentId: readNullableString(input, "sourceAgentId"),
    version: readNullableString(input, "version"),
  };
}

export function buildPackageManifest(input: Record<string, unknown>): AgentManifest | null {
  const kind = readAgentKind(input["kind"]);
  const runtime = readString(input, "runtime");
  const provider = readString(input, "provider");
  const model = readString(input, "model");
  const prompts = readRecordField(input, "prompts");
  const systemPrompt = readString(prompts, "system");
  const name = readString(input, "name");
  const runtimeSettings = input["settings"] ?? input["providerOptions"];

  if (
    kind === null ||
    !hasRequiredText(name) ||
    !hasRequiredText(runtime) ||
    !hasRequiredText(provider) ||
    !hasRequiredText(model) ||
    systemPrompt === null
  ) {
    return null;
  }

  return {
    advanced: null,
    builtInTools: normalizeAgentBuiltInTools(
      readParsedArray(input, "builtInTools", readBuiltInToolConfig),
    ),
    environment: readPackageEnvironment(input["environment"]),
    kind,
    manifestVersion: AGENT_MANIFEST_VERSION,
    mcpServers: readParsedArray(input, "mcpServers", readPackageMcpServer),
    metadata: {
      description: readNullableString(input, "description"),
      name,
    },
    prompts: {
      system: systemPrompt,
    },
    runtime: {
      id: runtime,
      model,
      provider,
      providerOptions: parseJsonObject(
        readJsonObjectField(runtimeSettings, "settings"),
        "Agent package settings",
      ),
    },
    skills: readParsedArray(input, "skills", readPackageSkill),
  };
}

function readNullableStringFromUnknown(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readAuthor(value: unknown): AgentPackage["author"] {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value, "name");
  if (!hasRequiredText(name)) {
    return null;
  }

  return {
    email: readNullableString(value, "email"),
    name,
  };
}

function readPackageEnvironment(value: unknown): AgentManifest["environment"] {
  if (!isRecord(value)) {
    return {
      environmentId: null,
      envVars: {},
      expectedName: null,
      setupScript: "",
    };
  }

  const secretNames = Array.isArray(value["secretNames"]) ? value["secretNames"] : [];
  const envVars: Record<string, string> = {};

  for (const secretName of secretNames) {
    if (typeof secretName === "string" && secretName.length > 0) {
      envVars[secretName] = "";
    }
  }

  return {
    environmentId: null,
    envVars,
    expectedName: readNullableString(value, "expectedName"),
    setupScript: readString(value, "setupScript") ?? "",
  };
}

function readPackageSkill(value: unknown): AgentManifestSkillReference | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value, "name");
  if (!hasRequiredText(name)) {
    return null;
  }

  return {
    ownerName: readNullableString(value, "ownerName"),
    skillId: readString(value, "path") ?? name,
    skillName: name,
    state: "active",
  };
}

function readPackageMcpServer(value: unknown): AgentManifestMcpServerBinding | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value, "name");
  const url = readString(value, "url");

  if (!hasRequiredText(name) || !hasRequiredText(url)) {
    return null;
  }

  const authType = readString(value, "authType");
  const credentialScope = readString(value, "credentialScope");
  const source = readString(value, "source");

  if (
    (authType !== "oauth" && authType !== "bearer") ||
    credentialScope !== "app" ||
    source !== "app"
  ) {
    return null;
  }

  return {
    authType,
    credentialMode: "runtime_resolved",
    credentialScope,
    enabled: readBooleanOrDefault(value, "enabled", true),
    iconUrl: readNullableString(value, "iconUrl"),
    name,
    serverId: null,
    source,
    url,
  };
}
