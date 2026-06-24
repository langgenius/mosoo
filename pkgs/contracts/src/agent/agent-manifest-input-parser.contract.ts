import { parseJsonObject } from "../validation/primitives.contract";
import {
  collectUnknownTopLevelFields,
  createValidationIssue,
  hasRecordEntries,
  hasRequiredText,
  isRecord,
  readAgentKind,
  readJsonObjectField,
  readMcpServerBinding,
  readNullableString,
  readParsedArray,
  readRecordField,
  readSkillReference,
  readString,
  readStringRecord,
} from "./agent-manifest-parser-internals.contract";
import { AGENT_MANIFEST_VERSION } from "./agent-manifest-version.contract";
import type {
  AgentManifest,
  AgentManifestValidationResult,
  AgentResolutionIssue,
} from "./agent-manifest.contract";
import type { AgentKind } from "./agent.contract";
import { AGENT_KIND_LIST_LABEL } from "./agent.contract";

interface ManifestSections {
  environment: Record<string, unknown>;
  kind: AgentKind | null;
  metadata: Record<string, unknown>;
  model: string | null;
  name: string | null;
  prompts: Record<string, unknown>;
  provider: string | null;
  runtime: Record<string, unknown>;
  runtimeId: string | null;
  systemPrompt: string | null;
}

interface CompleteManifestSections extends ManifestSections {
  kind: AgentKind;
  model: string;
  name: string;
  provider: string;
  runtimeId: string;
  systemPrompt: string;
}

export function parseAgentManifestInput(input: unknown): AgentManifestValidationResult {
  if (!isRecord(input)) {
    return {
      issues: [
        createValidationIssue({
          code: "manifest.invalid",
          message: "Agent Manifest must be a JSON object.",
          targetType: "agent",
        }),
      ],
      manifest: null,
    };
  }

  const sections = readManifestSections(input);
  const unknownFields = collectUnknownTopLevelFields(input);
  const issues = collectManifestIssues(input, sections, unknownFields);

  if (!hasCompleteManifestCore(sections)) {
    return {
      issues,
      manifest: null,
    };
  }

  if (hasBlockingManifestIssue(issues)) {
    return {
      issues,
      manifest: null,
    };
  }

  try {
    return {
      issues,
      manifest: buildAgentManifest(input, sections),
    };
  } catch (error) {
    return {
      issues: [
        ...issues,
        createValidationIssue({
          code: "manifest.invalid",
          message: error instanceof Error ? error.message : "Agent Manifest is invalid.",
          status: "unsupported",
          targetType: "agent",
        }),
      ],
      manifest: null,
    };
  }
}

function readManifestSections(input: Record<string, unknown>): ManifestSections {
  const metadata = readRecordField(input, "metadata");
  const runtime = readRecordField(input, "runtime");
  const prompts = readRecordField(input, "prompts");
  const environment = readRecordField(input, "environment");

  return {
    environment,
    kind: readAgentKind(input["kind"]),
    metadata,
    model: readString(runtime, "model"),
    name: readString(metadata, "name"),
    prompts,
    provider: readString(runtime, "provider"),
    runtime,
    runtimeId: readString(runtime, "id"),
    systemPrompt: readString(prompts, "system"),
  };
}

function collectManifestIssues(
  input: Record<string, unknown>,
  sections: ManifestSections,
  unknownFields: Record<string, unknown>,
): AgentResolutionIssue[] {
  const issues: AgentResolutionIssue[] = [];

  if (input["manifestVersion"] !== AGENT_MANIFEST_VERSION) {
    issues.push(
      createValidationIssue({
        code: "manifest.version.unsupported",
        message: `Agent Manifest version must be ${AGENT_MANIFEST_VERSION}.`,
        status: "unsupported",
        targetType: "agent",
      }),
    );
  }

  appendMissingManifestIssues(issues, sections);

  if (hasRecordEntries(unknownFields)) {
    issues.push(
      createValidationIssue({
        code: "manifest.unknown_fields",
        message: "Unknown top-level Manifest fields are not supported.",
        status: "unsupported",
        targetType: "agent",
      }),
    );
  }

  return issues;
}

function appendMissingManifestIssues(
  issues: AgentResolutionIssue[],
  sections: ManifestSections,
): void {
  if (!hasRequiredText(sections.name)) {
    issues.push(
      createValidationIssue({
        code: "manifest.metadata.name.missing",
        message: "Agent Manifest metadata.name is required.",
        targetType: "agent",
      }),
    );
  }

  if (sections.kind === null) {
    issues.push(
      createValidationIssue({
        code: "manifest.kind.missing",
        message: `Agent Manifest kind must be ${AGENT_KIND_LIST_LABEL}.`,
        targetType: "agent",
      }),
    );
  }

  if (!hasRequiredText(sections.runtimeId)) {
    issues.push(
      createValidationIssue({
        code: "manifest.runtime.missing",
        message: "Agent Manifest runtime.id is required.",
        targetType: "runtime",
      }),
    );
  }

  if (!hasRequiredText(sections.provider) || !hasRequiredText(sections.model)) {
    issues.push(
      createValidationIssue({
        code: "manifest.model.missing",
        message: "Agent Manifest runtime.provider and runtime.model are required.",
        targetType: "provider",
      }),
    );
  }
}

function hasCompleteManifestCore(sections: ManifestSections): sections is CompleteManifestSections {
  return (
    hasRequiredText(sections.name) &&
    sections.kind !== null &&
    hasRequiredText(sections.runtimeId) &&
    hasRequiredText(sections.provider) &&
    hasRequiredText(sections.model) &&
    sections.systemPrompt !== null
  );
}

function hasBlockingManifestIssue(issues: AgentResolutionIssue[]): boolean {
  return issues.some((issue) => issue.status === "unsupported");
}

function buildAgentManifest(
  input: Record<string, unknown>,
  sections: CompleteManifestSections,
): AgentManifest {
  const runtimeSettings = sections.runtime["settings"] ?? sections.runtime["providerOptions"];

  return {
    advanced: null,
    environment: {
      envVars: readStringRecord(sections.environment["envVars"]),
      environmentId: readNullableString(sections.environment, "environmentId"),
      expectedName: readNullableString(sections.environment, "expectedName"),
      setupScript: readString(sections.environment, "setupScript") ?? "",
    },
    kind: sections.kind,
    manifestVersion: AGENT_MANIFEST_VERSION,
    mcpServers: readParsedArray(input, "mcpServers", readMcpServerBinding),
    metadata: {
      description: readNullableString(sections.metadata, "description"),
      name: sections.name,
    },
    prompts: {
      system: sections.systemPrompt,
    },
    runtime: {
      id: sections.runtimeId,
      model: sections.model,
      provider: sections.provider,
      providerOptions: parseJsonObject(
        readJsonObjectField(runtimeSettings, "runtime.settings"),
        "Agent Manifest runtime.settings",
      ),
    },
    skills: readParsedArray(input, "skills", readSkillReference),
  };
}
