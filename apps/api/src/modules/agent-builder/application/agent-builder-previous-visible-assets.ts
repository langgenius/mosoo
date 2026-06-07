import type {
  AgentBuilderComponentDecision,
  AgentBuilderComponentDecisions,
  AgentBuilderPlannerDraftBindingsContext,
  AgentBuilderPreviousVisibleAssetsContext,
  AgentBuilderVisibleAssetIndexEntry,
  AgentBuilderVisibleAssetsContext,
} from "@mosoo/contracts/agent-builder";

import {
  parseMcpServerIdList,
  parseNullableEnvironmentId,
  parseSkillIdList,
  parseSpaceIdList,
} from "./agent-builder-ids";
import { emptyVisibleAssetChanges } from "./agent-builder-visible-asset-index";
import type {
  VisibleAssetCurrentIndex,
  VisibleAssetIndexEntry,
} from "./agent-builder-visible-assets.types";

interface ReadIndexEntriesResult {
  entries: VisibleAssetIndexEntry[];
  valid: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function emptyDraftBindings(): AgentBuilderPlannerDraftBindingsContext {
  return {
    componentDecisions: {},
    environmentId: null,
    mcpServerIds: [],
    parseError: null,
    parseStatus: "parsed",
    skillIds: [],
    spaceIds: [],
  };
}

function readComponentDecision(value: unknown): AgentBuilderComponentDecision | null {
  return value === "bound" || value === "created" || value === "skipped" ? value : null;
}

function readComponentDecisions(value: unknown): AgentBuilderComponentDecisions {
  const decisions = isRecord(value) ? value : {};
  const environment = readComponentDecision(decisions["environment"]);

  return environment === null ? {} : { environment };
}

function readNullableString(value: unknown): string | null {
  return value === null || typeof value === "string" ? value : null;
}

export function availablePreviousVisibleAssetsContext(): AgentBuilderPreviousVisibleAssetsContext {
  return {
    errorMessage: null,
    status: "available",
  };
}

export function invalidPreviousVisibleAssetsContext(): AgentBuilderPreviousVisibleAssetsContext {
  return {
    errorMessage: "Agent Builder previous planner context JSON could not be parsed.",
    status: "invalid",
  };
}

export function missingPreviousVisibleAssetsContext(): AgentBuilderPreviousVisibleAssetsContext {
  return {
    errorMessage: null,
    status: "missing",
  };
}

function readPreviousContext(value: unknown): AgentBuilderPreviousVisibleAssetsContext {
  if (!isRecord(value)) {
    return missingPreviousVisibleAssetsContext();
  }

  const status = value["status"];

  if (status !== "available" && status !== "invalid" && status !== "missing") {
    return missingPreviousVisibleAssetsContext();
  }

  return {
    errorMessage: readNullableString(value["errorMessage"]),
    status,
  };
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string").toSorted();
}

function readDraftBindings(value: unknown): AgentBuilderPlannerDraftBindingsContext {
  if (!isRecord(value)) {
    return emptyDraftBindings();
  }

  const parseStatus = value["parseStatus"] === "failed" ? "failed" : "parsed";

  return {
    componentDecisions: readComponentDecisions(value["componentDecisions"]),
    environmentId: parseNullableEnvironmentId(
      readNullableString(value["environmentId"]),
      "environmentId",
    ),
    mcpServerIds: parseMcpServerIdList(readStringList(value["mcpServerIds"]), "mcpServerIds"),
    parseError: readNullableString(value["parseError"]),
    parseStatus,
    skillIds: parseSkillIdList(readStringList(value["skillIds"]), "skillIds"),
    spaceIds: parseSpaceIdList(readStringList(value["spaceIds"]), "spaceIds"),
  };
}

function readIndexEntries(
  value: unknown,
  kind: AgentBuilderVisibleAssetIndexEntry["kind"],
): ReadIndexEntriesResult {
  if (value === undefined) {
    return {
      entries: [],
      valid: true,
    };
  }

  if (!Array.isArray(value)) {
    return {
      entries: [],
      valid: false,
    };
  }

  const entries: VisibleAssetIndexEntry[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      return {
        entries: [],
        valid: false,
      };
    }

    const bindingState = entry["bindingState"];
    const hash = readString(entry["hash"]);
    const id = readString(entry["id"]);
    const name = readString(entry["name"]);

    if (
      hash === null ||
      id === null ||
      name === null ||
      (bindingState !== "bound" &&
        bindingState !== "not_bound" &&
        bindingState !== "not_represented")
    ) {
      return {
        entries: [],
        valid: false,
      };
    }

    entries.push({
      bindingState,
      hash,
      id,
      kind,
      name,
    });
  }

  return {
    entries,
    valid: true,
  };
}

function readVisibleAssetCurrentIndex(value: Record<string, unknown>): {
  index: VisibleAssetCurrentIndex;
  valid: boolean;
} {
  const environments = readIndexEntries(value["environments"], "environment");
  const mcpServers = readIndexEntries(value["mcpServers"], "mcp_server");
  const selectedSpaceFiles = readIndexEntries(value["selectedSpaceFiles"], "selected_space_files");
  const skills = readIndexEntries(value["skills"], "skill");
  const spaces = readIndexEntries(value["spaces"], "space");

  return {
    index: {
      environments: environments.entries,
      mcpServers: mcpServers.entries,
      selectedSpaceFiles: selectedSpaceFiles.entries,
      skills: skills.entries,
      spaces: spaces.entries,
    },
    valid:
      environments.valid &&
      mcpServers.valid &&
      selectedSpaceFiles.valid &&
      skills.valid &&
      spaces.valid,
  };
}

export function readVisibleAssetsFromPlannerContextJson(
  contextJson: string | null,
): AgentBuilderVisibleAssetsContext | null {
  return readPreviousVisibleAssetsFromPlannerContextJson(contextJson).assets;
}

export function readPreviousVisibleAssetsFromPlannerContextJson(contextJson: string | null): {
  readonly assets: AgentBuilderVisibleAssetsContext | null;
  readonly context: AgentBuilderPreviousVisibleAssetsContext;
} {
  if (contextJson === null) {
    return {
      assets: null,
      context: missingPreviousVisibleAssetsContext(),
    };
  }

  try {
    const parsed: unknown = JSON.parse(contextJson);
    const root = isRecord(parsed) ? parsed : null;
    const assets = root !== null && isRecord(root["assets"]) ? root["assets"] : null;

    if (root === null || assets === null || assets["currentIndex"] === undefined) {
      return {
        assets: null,
        context: missingPreviousVisibleAssetsContext(),
      };
    }

    if (!isRecord(assets["currentIndex"])) {
      return {
        assets: null,
        context: invalidPreviousVisibleAssetsContext(),
      };
    }

    const currentIndexValue = assets["currentIndex"];

    if (Object.keys(currentIndexValue).length === 0) {
      return {
        assets: null,
        context: missingPreviousVisibleAssetsContext(),
      };
    }

    const currentIndex = readVisibleAssetCurrentIndex(currentIndexValue);

    if (!currentIndex.valid) {
      return {
        assets: null,
        context: invalidPreviousVisibleAssetsContext(),
      };
    }

    return {
      assets: {
        changesSinceLastTurn: emptyVisibleAssetChanges(),
        currentIndex: currentIndex.index,
        draftBindings: readDraftBindings(assets["draftBindings"]),
        observedAt: readString(assets["observedAt"]) ?? "",
        previousContext: readPreviousContext(assets["previousContext"]),
        snapshotHash: readString(assets["snapshotHash"]) ?? "",
      },
      context: availablePreviousVisibleAssetsContext(),
    };
  } catch {
    return {
      assets: null,
      context: invalidPreviousVisibleAssetsContext(),
    };
  }
}
