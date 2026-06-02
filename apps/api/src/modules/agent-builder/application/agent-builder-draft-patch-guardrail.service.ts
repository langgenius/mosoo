import type {
  AgentBuilderDraftPatchChange,
  AgentBuilderPlannerOutput,
  AgentBuilderReadinessContext,
  AgentBuilderReadinessIssueSummary,
} from "@mosoo/contracts/agent-builder";
import { parseDocument, stringify } from "yaml";

const DIRECTLY_REPAIRABLE_READINESS_CODES = new Set<string>([
  "agent.runtime.unsupported",
  "agent_builder.model.missing",
  "agent_builder.provider.missing",
  "agent_builder.runtime.missing",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ensureRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];

  if (isRecord(value)) {
    return value;
  }

  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function readAutoAppliedDraftPatches(
  output: AgentBuilderPlannerOutput,
): AgentBuilderDraftPatchChange[] {
  if (output.mode !== "draft_patch") {
    return [];
  }

  return output.nodes.flatMap((node) => {
    const draftPatch = node.draftPatch;

    return node.status === "applied" && draftPatch?.autoApply === true ? [draftPatch] : [];
  });
}

function normalizeStringArray(value: AgentBuilderDraftPatchChange["value"]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const values: string[] = [];

  for (const rawValue of value) {
    const nextValue = rawValue.trim();

    if (nextValue.length === 0 || seen.has(nextValue)) {
      continue;
    }

    seen.add(nextValue);
    values.push(nextValue);
  }

  return values;
}

function applyDraftPatchToMutableYamlShape(
  root: Record<string, unknown>,
  draftPatch: AgentBuilderDraftPatchChange,
): void {
  const assets = ensureRecord(root, "assets");
  const environment = ensureRecord(root, "environment");
  const identity = ensureRecord(root, "identity");
  const runtime = ensureRecord(root, "runtime");

  switch (draftPatch.fieldPath) {
    case "description":
      identity["description"] = typeof draftPatch.value === "string" ? draftPatch.value : "";
      return;
    case "environmentId":
      environment["environmentId"] =
        typeof draftPatch.value === "string" && draftPatch.value.trim().length > 0
          ? draftPatch.value.trim()
          : null;
      return;
    case "mcpServerIds":
      assets["mcpServers"] = normalizeStringArray(draftPatch.value);
      return;
    case "model":
      runtime["model"] = typeof draftPatch.value === "string" ? draftPatch.value : "";
      return;
    case "name":
      identity["name"] = typeof draftPatch.value === "string" ? draftPatch.value : "";
      return;
    case "prompt":
      root["prompt"] = typeof draftPatch.value === "string" ? draftPatch.value : "";
      return;
    case "provider":
      runtime["provider"] = typeof draftPatch.value === "string" ? draftPatch.value : "";
      return;
    case "runtimeId":
      runtime["id"] = typeof draftPatch.value === "string" ? draftPatch.value : "";
      return;
    case "skillIds":
      assets["skills"] = normalizeStringArray(draftPatch.value);
      return;
    case "spaceIds":
      assets["spaces"] = normalizeStringArray(draftPatch.value);
      return;
  }
}

export function applyAgentBuilderDraftPatchOutputToYaml(
  draftYaml: string,
  output: AgentBuilderPlannerOutput,
): string {
  const document = parseDocument(draftYaml);

  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join("; "));
  }

  const parsed: unknown = document.toJSON();
  const root = isRecord(parsed) ? { ...parsed } : {};

  for (const draftPatch of readAutoAppliedDraftPatches(output)) {
    applyDraftPatchToMutableYamlShape(root, draftPatch);
  }

  return stringify(root, {
    collectionStyle: "block",
    lineWidth: 0,
    sortMapEntries: false,
  }).trimEnd();
}

export function findRepairableDraftReadinessErrors(
  readiness: AgentBuilderReadinessContext,
): AgentBuilderReadinessIssueSummary[] {
  return readiness.issues.filter(
    (issue) =>
      issue.severity === "error" &&
      (DIRECTLY_REPAIRABLE_READINESS_CODES.has(issue.code) ||
        issue.code === "agent.capability.agent.readiness.runtime.unsupported" ||
        issue.code === "agent.capability.agent.readiness.runtime.disabled" ||
        issue.code === "agent.capability.agent.readiness.model.unavailable"),
  );
}

function createReadinessIssueKey(issue: AgentBuilderReadinessIssueSummary): string {
  return [issue.severity, issue.code, issue.message].join("\u0000");
}

export function findNewRepairableDraftReadinessErrors(input: {
  after: AgentBuilderReadinessContext;
  before: AgentBuilderReadinessContext;
}): AgentBuilderReadinessIssueSummary[] {
  const existingIssueKeys = new Set(
    findRepairableDraftReadinessErrors(input.before).map((issue) => createReadinessIssueKey(issue)),
  );

  return findRepairableDraftReadinessErrors(input.after).filter(
    (issue) => !existingIssueKeys.has(createReadinessIssueKey(issue)),
  );
}
