import {
  PUBLIC_RUNTIME_CATALOG,
  getRuntimeCatalogEntry,
  isPublicRuntimeCatalogEntry,
} from "@mosoo/runtime-catalog";

import type { RuntimeInfo } from "./agent.types";

const RUNTIME_COLOR_BY_ID: Record<string, string> = {
  "claude-agent-sdk": "#D97757",
  "openai-runtime": "#7A9DFF",
};

const FALLBACK_RUNTIME_COLOR_INK_700 = "#3d434b";
const FALLBACK_RUNTIME_COLOR_INK_500 = "#656c75";

function toRuntimeInfo(entry: (typeof PUBLIC_RUNTIME_CATALOG)[number]): RuntimeInfo {
  return {
    color: RUNTIME_COLOR_BY_ID[entry.runtimeId] ?? FALLBACK_RUNTIME_COLOR_INK_700,
    defaultModel: entry.defaultModel,
    icon: entry.label
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join(""),
    id: entry.runtimeId,
    name: entry.label,
    provider: entry.defaultProvider,
    vendor: entry.vendors[0]?.label ?? entry.defaultProvider,
  };
}

export const RUNTIMES: RuntimeInfo[] = PUBLIC_RUNTIME_CATALOG.map((entry) => toRuntimeInfo(entry));

function createExternalRuntimeInfo(runtimeId: string): RuntimeInfo {
  if (runtimeId === "__private_runtime__") {
    return {
      color: FALLBACK_RUNTIME_COLOR_INK_500,
      defaultModel: "",
      icon: "RT",
      id: runtimeId,
      name: "Runtime",
      provider: "private",
      vendor: "Runtime",
    };
  }

  return {
    color: FALLBACK_RUNTIME_COLOR_INK_500,
    defaultModel: "",
    icon:
      runtimeId
        .split(/[^a-z0-9]+/i)
        .filter((part) => part.length > 0)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "RT",
    id: runtimeId,
    name: runtimeId,
    provider: "unknown",
    vendor: "External",
  };
}

export function listRuntimeOptions(currentRuntimeId?: string | null): RuntimeInfo[] {
  if (
    currentRuntimeId === undefined ||
    currentRuntimeId === null ||
    currentRuntimeId.length === 0 ||
    isPublicRuntimeCatalogEntry(currentRuntimeId)
  ) {
    return RUNTIMES;
  }

  const currentRuntime = getRuntimeCatalogEntry(currentRuntimeId);

  if (currentRuntime === null) {
    return [...RUNTIMES, createExternalRuntimeInfo(currentRuntimeId)];
  }

  return [...RUNTIMES, toRuntimeInfo(currentRuntime)];
}

export function isRuntimeSelectable(runtimeId: string): boolean {
  return isPublicRuntimeCatalogEntry(runtimeId);
}

export function getRuntimeInfo(id: string): RuntimeInfo {
  const runtime = listRuntimeOptions(id).find((candidate) => candidate.id === id);

  if (!runtime) {
    throw new Error(`Unknown runtime: ${id}.`);
  }

  return runtime;
}
