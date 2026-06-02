import { parseDocument } from "yaml";

import {
  parseChannelBindingIdList,
  parseMcpServerIdList,
  parseNullableEnvironmentId,
  parseNullableFileId,
  parseSkillIdList,
  parseSpaceId,
} from "./agent-builder-ids";
import { compareByNameThenId, normalizeUnique } from "./agent-builder-visible-asset-model";
import type {
  AgentBuilderParsedDraftContext,
  DraftSpaceBinding,
} from "./agent-builder-visible-assets.types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNullableString(value: unknown): string | null {
  return value === null || typeof value === "string" ? value : null;
}

function readRawIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeUnique(
    value.flatMap((entry) => {
      if (typeof entry === "string") {
        return [entry];
      }

      if (!isRecord(entry)) {
        return [];
      }

      const id = readString(entry["id"]) ?? readString(entry["serverId"]);
      const state = readString(entry["state"]);

      return id !== null && state !== "tombstone" ? [id] : [];
    }),
  );
}

function readSpaceBindings(value: unknown): DraftSpaceBinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byId = new Map<string, DraftSpaceBinding>();

  for (const entry of value) {
    if (typeof entry === "string") {
      const id = parseSpaceId(entry, "assets.spaces[].id");

      if (id.length > 0 && !byId.has(id)) {
        byId.set(id, { id, name: id });
      }

      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    const id = readString(entry["id"]);
    const state = readString(entry["state"]);

    if (id !== null && state !== "tombstone") {
      const spaceId = parseSpaceId(id, "assets.spaces[].id");
      const name = readString(entry["name"]) ?? id;
      byId.set(spaceId, { id: spaceId, name });
    }
  }

  return [...byId.values()].toSorted((left, right) => compareByNameThenId(left, right));
}

function emptyDraftBindings(parseError: string | null): AgentBuilderParsedDraftContext {
  return {
    agentsFileId: null,
    channelIds: [],
    description: null,
    environmentId: null,
    mcpServerIds: [],
    mcpServersRepresented: false,
    model: null,
    name: null,
    parseError,
    parseStatus: parseError === null ? "parsed" : "failed",
    prompt: null,
    provider: null,
    runtimeId: null,
    skillIds: [],
    spaceIds: [],
    spaces: [],
  };
}

export function parseAgentBuilderPlannerDraft(draftYaml: string): AgentBuilderParsedDraftContext {
  try {
    const document = parseDocument(draftYaml);

    if (document.errors.length > 0) {
      return emptyDraftBindings(document.errors.map((error) => error.message).join("; "));
    }

    const parsed: unknown = document.toJSON();
    if (!isRecord(parsed)) {
      return emptyDraftBindings("Draft YAML must be an object.");
    }

    const root = parsed;
    const assets = isRecord(root["assets"]) ? root["assets"] : {};
    const environment = isRecord(root["environment"]) ? root["environment"] : {};
    const identity = isRecord(root["identity"]) ? root["identity"] : {};
    const channels = isRecord(root["channels"]) ? root["channels"] : {};
    const runtime = isRecord(root["runtime"]) ? root["runtime"] : {};
    const mcpServers = assets["mcpServers"];
    const spaces = readSpaceBindings(assets["spaces"]);

    return {
      agentsFileId: parseNullableFileId(
        readNullableString(assets["agentsFileId"]),
        "assets.agentsFileId",
      ),
      channelIds: parseChannelBindingIdList(
        readRawIdList(channels["providers"] ?? channels["setups"]),
        "channels.providers",
      ),
      description: readString(identity["description"]),
      environmentId: parseNullableEnvironmentId(
        readNullableString(environment["environmentId"]),
        "environment.environmentId",
      ),
      mcpServerIds: parseMcpServerIdList(readRawIdList(mcpServers), "assets.mcpServers"),
      mcpServersRepresented: Array.isArray(mcpServers),
      model: readString(runtime["model"]),
      name: readString(identity["name"]),
      parseError: null,
      parseStatus: "parsed",
      prompt: readString(root["prompt"]),
      provider: readString(runtime["provider"]),
      runtimeId: readString(runtime["id"]),
      skillIds: parseSkillIdList(readRawIdList(assets["skills"]), "assets.skills"),
      spaceIds: normalizeUnique(spaces.map((space) => space.id)),
      spaces,
    };
  } catch (error) {
    return emptyDraftBindings(error instanceof Error ? error.message : "Draft YAML parse failed.");
  }
}
