import type {
  AgentBuilderStarterPackItemAssetType,
  AgentBuilderToolExecutionRecord,
  AgentBuilderToolId,
  AgentBuilderVisibleAssetBindingState,
} from "@mosoo/contracts/agent-builder";

export type BindableStarterPackAssetType = Extract<
  AgentBuilderStarterPackItemAssetType,
  "environment" | "mcp" | "skill" | "space"
>;

export interface ResolvedAssetReference {
  readonly assetType: BindableStarterPackAssetType;
  readonly bindingState?: AgentBuilderVisibleAssetBindingState;
  readonly id: string;
  readonly name: string;
}

export interface AmbiguousAssetReferences {
  readonly assetType: BindableStarterPackAssetType;
  readonly candidates: ResolvedAssetReference[];
  readonly referenceText?: string;
}

export const PREPARE_BIND_TOOL_IDS = {
  environment: "prepare_bind_environment_patch",
  mcp: "prepare_bind_mcp_patch",
  skill: "prepare_bind_skill_patch",
  space: "prepare_bind_space_patch",
} as const satisfies Record<BindableStarterPackAssetType, AgentBuilderToolId>;

function assetTypeForPrepareBindToolId(
  toolId: AgentBuilderToolId | null,
): BindableStarterPackAssetType | null {
  if (toolId === "prepare_bind_environment_patch") {
    return "environment";
  }

  if (toolId === "prepare_bind_mcp_patch") {
    return "mcp";
  }

  if (toolId === "prepare_bind_skill_patch") {
    return "skill";
  }

  if (toolId === "prepare_bind_space_patch") {
    return "space";
  }

  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function readBindableAssetType(value: unknown): BindableStarterPackAssetType | null {
  if (value === "mcp_server") {
    return "mcp";
  }

  if (value === "environment" || value === "mcp" || value === "skill" || value === "space") {
    return value;
  }

  return null;
}

function readBindingState(value: unknown): AgentBuilderVisibleAssetBindingState | null {
  if (value === "bound" || value === "not_bound" || value === "not_represented") {
    return value;
  }

  return null;
}

function readOutputAssetReference(
  value: unknown,
  fallbackAssetType: unknown,
): ResolvedAssetReference | null {
  if (!isRecord(value)) {
    return null;
  }

  const assetType = readBindableAssetType(value["assetType"] ?? fallbackAssetType);
  const bindingState = readBindingState(value["bindingState"]);
  const id = readString(value["id"]);
  const name = readString(value["name"]);

  if (assetType === null || id === null || name === null) {
    return null;
  }

  return {
    assetType,
    ...(bindingState === null ? {} : { bindingState }),
    id,
    name,
  };
}

export function displayAssetType(assetType: BindableStarterPackAssetType): string {
  if (assetType === "environment") {
    return "Environment";
  }

  if (assetType === "mcp") {
    return "MCP";
  }

  if (assetType === "skill") {
    return "Skill";
  }

  return "Space";
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/['"`“”‘’]/gu, "")
    .replace(/[_\-–—/:：]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function nodeKeyPart(value: string): string {
  return (
    normalizeSearchText(value)
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 48) || "asset"
  );
}

export function recordOutput(
  record: AgentBuilderToolExecutionRecord,
): Record<string, unknown> | null {
  return isRecord(record.output) ? record.output : null;
}

function readResolvedAssetReference(
  record: AgentBuilderToolExecutionRecord,
): ResolvedAssetReference | null {
  if (
    record.toolId !== "resolve_asset_reference" ||
    record.status !== "completed" ||
    record.errorMessage !== null
  ) {
    return null;
  }

  const output = recordOutput(record);
  const resolvedAsset = isRecord(output?.["resolvedAsset"]) ? output["resolvedAsset"] : null;

  if (output?.["status"] !== "resolved" || resolvedAsset === null) {
    return null;
  }

  return readOutputAssetReference(resolvedAsset, output["assetType"]);
}

function readAmbiguousAssetReferences(
  record: AgentBuilderToolExecutionRecord,
): AmbiguousAssetReferences | null {
  if (
    record.toolId !== "resolve_asset_reference" ||
    record.status !== "completed" ||
    record.errorMessage !== null
  ) {
    return null;
  }

  const output = recordOutput(record);
  const assetType = readBindableAssetType(output?.["assetType"]);
  const candidates = Array.isArray(output?.["candidates"]) ? output["candidates"] : null;

  if (assetType === null || output?.["status"] !== "ambiguous" || candidates === null) {
    return null;
  }

  const references = candidates
    .map((candidate) => readOutputAssetReference(candidate, assetType))
    .filter((candidate): candidate is ResolvedAssetReference => candidate !== null);

  if (references.length === 0) {
    return null;
  }

  const reference = isRecord(output["reference"]) ? output["reference"] : null;
  const referenceText = readString(reference?.["text"]);

  return {
    assetType,
    candidates: references,
    ...(referenceText === null ? {} : { referenceText }),
  };
}

export function listResolvedAssetReferences(
  trace: readonly AgentBuilderToolExecutionRecord[],
): ResolvedAssetReference[] {
  return trace.flatMap((record) => {
    const resolvedAsset = readResolvedAssetReference(record);

    return resolvedAsset === null ? [] : [resolvedAsset];
  });
}

export function listAmbiguousAssetReferences(
  trace: readonly AgentBuilderToolExecutionRecord[],
): AmbiguousAssetReferences[] {
  return trace.flatMap((record) => {
    const ambiguousReference = readAmbiguousAssetReferences(record);

    return ambiguousReference === null ? [] : [ambiguousReference];
  });
}

export function findResolvedAssetForFailedPrepareBind(
  record: AgentBuilderToolExecutionRecord,
  resolvedAssets: readonly ResolvedAssetReference[],
): ResolvedAssetReference | null {
  if (
    record.status !== "failed" ||
    record.errorMessage !== "assetName is required." ||
    readString(record.input["assetId"]) === null
  ) {
    return null;
  }

  const assetType = assetTypeForPrepareBindToolId(record.toolId);
  const assetId = readString(record.input["assetId"]);

  if (assetType === null || assetId === null) {
    return null;
  }

  return (
    resolvedAssets.find((asset) => asset.assetType === assetType && asset.id === assetId) ?? null
  );
}

export function outputStatus(record: AgentBuilderToolExecutionRecord): string | null {
  return readString(recordOutput(record)?.["status"]);
}
