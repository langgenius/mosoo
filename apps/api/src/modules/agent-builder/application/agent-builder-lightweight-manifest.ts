import type { AgentConfigBuilderMetadata, AgentKind } from "@mosoo/contracts/agent";
import { AGENT_KIND_VALUES } from "@mosoo/contracts/agent";
import type {
  AgentBuilderComponentDecision,
  AgentBuilderComponentDecisions,
} from "@mosoo/contracts/agent-builder";
import type { EnvironmentId, McpServerId, PlatformId, SkillId, SpaceId } from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";
import { parseDocument } from "yaml";

export interface AgentBuilderLightweightManifest {
  readonly activeMcpServerIds: McpServerId[];
  readonly activeSkillIds: SkillId[];
  readonly builder: AgentConfigBuilderMetadata;
  readonly componentDecisions: AgentBuilderComponentDecisions;
  readonly description: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly kind: AgentKind | null;
  readonly mcpServersRepresented: boolean;
  readonly mcpServerIds: McpServerId[];
  readonly model: string | null;
  readonly name: string | null;
  readonly prompt: string | null;
  readonly provider: string | null;
  readonly runtimeId: string | null;
  readonly skillIds: SkillId[];
  readonly spaceBindings: AgentBuilderLightweightSpaceBinding[];
  readonly spaceIds: SpaceId[];
}

export interface AgentBuilderLightweightSpaceBinding {
  readonly id: SpaceId;
  readonly name: string;
}

type AgentBuilderLightweightAssetState = "active" | "tombstone";

interface ParsedAgentBuilderLightweightManifest {
  readonly manifest: AgentBuilderLightweightManifest;
  readonly status: "parsed";
}

interface FailedAgentBuilderLightweightManifest {
  readonly error: string;
  readonly status: "failed";
}

type AgentBuilderLightweightManifestParseResult =
  | FailedAgentBuilderLightweightManifest
  | ParsedAgentBuilderLightweightManifest;

interface AgentBuilderLightweightAssetIdList {
  readonly activeIds: string[];
  readonly ids: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readOptionalRecordSection(
  source: Record<string, unknown>,
  key: string,
  label = key,
): Record<string, unknown> {
  const value = source[key];

  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readOptionalStringField(
  source: Record<string, unknown>,
  key: string,
  label = key,
): string | null {
  const value = source[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null.`);
  }

  return value;
}

function readOptionalAgentKindField(source: Record<string, unknown>): AgentKind | null {
  const value = source["kind"];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("kind must be a string or null.");
  }

  if (!(AGENT_KIND_VALUES as readonly string[]).includes(value)) {
    throw new Error(`kind must be one of: ${AGENT_KIND_VALUES.join(", ")}.`);
  }

  return value as AgentKind;
}

function readOptionalComponentDecisionField(
  source: Record<string, unknown>,
  key: string,
  label = key,
): AgentBuilderComponentDecision | undefined {
  const value = source[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (value === "bound" || value === "created" || value === "skipped") {
    return value;
  }

  if (typeof value === "string") {
    throw new Error(`${label} must be one of: bound, created, skipped.`);
  }

  throw new Error(`${label} must be a string or null.`);
}

function readOptionalAssetStateField(
  source: Record<string, unknown>,
  label: string,
): AgentBuilderLightweightAssetState | null {
  const value = source["state"];

  if (value === undefined || value === null) {
    return null;
  }

  if (value === "active" || value === "tombstone") {
    return value;
  }

  if (typeof value === "string") {
    throw new Error(`${label}.state must be one of: active, tombstone.`);
  }

  throw new Error(`${label}.state must be a string or null.`);
}

function readComponentDecisions(value: unknown): AgentBuilderComponentDecisions {
  const decisions = isRecord(value) ? value : {};
  const environment = readOptionalComponentDecisionField(
    decisions,
    "environment",
    "builder.componentDecisions.environment",
  );

  return environment === undefined ? {} : { environment };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function readIdListWithActiveIds(
  value: unknown,
  label: string,
): AgentBuilderLightweightAssetIdList {
  if (value === undefined || value === null) {
    return {
      activeIds: [],
      ids: [],
    };
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  const ids: string[] = [];
  const activeIds: string[] = [];

  for (const [index, entry] of value.entries()) {
    if (typeof entry === "string") {
      ids.push(entry);
      activeIds.push(entry);
      continue;
    }

    if (isRecord(entry)) {
      const id = readString(entry["id"]);

      if (id !== null) {
        const state = readOptionalAssetStateField(entry, `${label}[${index}]`);
        ids.push(id);

        if (state !== "tombstone") {
          activeIds.push(id);
        }
        continue;
      }
    }

    throw new Error(`${label}[${index}] must be a string ID or object with id.`);
  }

  return {
    activeIds: uniqueStrings(activeIds),
    ids: uniqueStrings(ids),
  };
}

function compareSpaceBindings(
  left: AgentBuilderLightweightSpaceBinding,
  right: AgentBuilderLightweightSpaceBinding,
): number {
  const byName = left.name.localeCompare(right.name);

  return byName === 0 ? left.id.localeCompare(right.id) : byName;
}

function readSpaceBindings(value: unknown): AgentBuilderLightweightSpaceBinding[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("assets.spaces must be an array.");
  }

  const byId = new Map<SpaceId, AgentBuilderLightweightSpaceBinding>();

  for (const [index, entry] of value.entries()) {
    if (typeof entry === "string") {
      const id = parsePlatformId<SpaceId>(entry, "assets.spaces[].id");

      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: id,
        });
      }
      continue;
    }

    if (!isRecord(entry)) {
      throw new Error(`assets.spaces[${index}] must be a string ID or object with id.`);
    }

    const rawId = readString(entry["id"]);

    if (rawId === null) {
      throw new Error(`assets.spaces[${index}] must be a string ID or object with id.`);
    }

    const id = parsePlatformId<SpaceId>(rawId, "assets.spaces[].id");
    const state = readOptionalAssetStateField(entry, `assets.spaces[${index}]`);

    if (state === "tombstone") {
      continue;
    }

    byId.set(id, {
      id,
      name: readOptionalStringField(entry, "name", `assets.spaces[${index}].name`) ?? rawId,
    });
  }

  return [...byId.values()].toSorted(compareSpaceBindings);
}

function parseIdList<TId extends PlatformId>(values: readonly string[], label: string): TId[] {
  return values.map((value, index) => parsePlatformId<TId>(value, `${label}.${index}`));
}

function readEnvironmentId(value: string | null): EnvironmentId | null {
  if (value === null || value.trim().length === 0) {
    return null;
  }

  return parsePlatformId<EnvironmentId>(value, "environment.environmentId");
}

function emptyManifest(): AgentBuilderLightweightManifest {
  return {
    activeMcpServerIds: [],
    activeSkillIds: [],
    builder: {
      componentDecisions: {},
    },
    componentDecisions: {},
    description: null,
    environmentId: null,
    kind: null,
    mcpServersRepresented: false,
    mcpServerIds: [],
    model: null,
    name: null,
    prompt: null,
    provider: null,
    runtimeId: null,
    skillIds: [],
    spaceBindings: [],
    spaceIds: [],
  };
}

export function parseAgentBuilderLightweightManifestYaml(
  draftYaml: string,
): AgentBuilderLightweightManifestParseResult {
  try {
    const document = parseDocument(draftYaml);

    if (document.errors.length > 0) {
      return {
        error: document.errors.map((error) => error.message).join("; "),
        status: "failed",
      };
    }

    const parsed: unknown = document.toJSON();

    if (!isRecord(parsed)) {
      return {
        error: "Agent Builder Manifest YAML must be an object.",
        status: "failed",
      };
    }

    const assets = readOptionalRecordSection(parsed, "assets");
    const builder = readOptionalRecordSection(parsed, "builder");
    const componentDecisions = readOptionalRecordSection(
      builder,
      "componentDecisions",
      "builder.componentDecisions",
    );
    const environment = readOptionalRecordSection(parsed, "environment");
    const identity = readOptionalRecordSection(parsed, "identity");
    const runtime = readOptionalRecordSection(parsed, "runtime");
    const decisions = readComponentDecisions(componentDecisions);
    const mcpServerIdList = readIdListWithActiveIds(assets["mcpServers"], "assets.mcpServers");
    const skillIdList = readIdListWithActiveIds(assets["skills"], "assets.skills");
    const spaceBindings = readSpaceBindings(assets["spaces"]);

    return {
      manifest: {
        ...emptyManifest(),
        builder: {
          componentDecisions:
            decisions.environment === undefined ? {} : { environment: decisions.environment },
        },
        componentDecisions: decisions,
        description: readOptionalStringField(identity, "description", "identity.description"),
        environmentId: readEnvironmentId(
          readOptionalStringField(environment, "environmentId", "environment.environmentId"),
        ),
        kind: readOptionalAgentKindField(parsed),
        activeMcpServerIds: parseIdList<McpServerId>(
          mcpServerIdList.activeIds,
          "assets.mcpServers",
        ),
        mcpServersRepresented: Array.isArray(assets["mcpServers"]),
        mcpServerIds: parseIdList<McpServerId>(mcpServerIdList.ids, "assets.mcpServers"),
        model: readOptionalStringField(runtime, "model", "runtime.model"),
        name: readOptionalStringField(identity, "name", "identity.name"),
        prompt: readOptionalStringField(parsed, "prompt"),
        provider: readOptionalStringField(runtime, "provider", "runtime.provider"),
        runtimeId: readOptionalStringField(runtime, "id", "runtime.id"),
        activeSkillIds: parseIdList<SkillId>(skillIdList.activeIds, "assets.skills"),
        skillIds: parseIdList<SkillId>(skillIdList.ids, "assets.skills"),
        spaceBindings,
        spaceIds: spaceBindings.map((space) => space.id),
      },
      status: "parsed",
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Agent Builder Manifest parse failed.",
      status: "failed",
    };
  }
}
