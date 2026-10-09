import { RUNTIME_CATALOG, getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";

import type { RuntimeInfo } from "./agent.types";

// Initials for a runtime without a mark use the neutral ink ramp.
const FALLBACK_RUNTIME_COLOR_INK_700 = "var(--ink-700)";
const FALLBACK_RUNTIME_COLOR_INK_500 = "var(--ink-500)";

function toRuntimeInfo(entry: (typeof RUNTIME_CATALOG)[number]): RuntimeInfo {
  return {
    color: entry.display.color ?? FALLBACK_RUNTIME_COLOR_INK_700,
    icon: entry.label
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join(""),
    id: entry.runtimeId,
    name: entry.label,
    provider: entry.defaultProvider,
    vendor: entry.display.providerLabel,
  };
}

const RUNTIMES: RuntimeInfo[] = RUNTIME_CATALOG.map((entry) => toRuntimeInfo(entry));

function createExternalRuntimeInfo(runtimeId: string): RuntimeInfo {
  return {
    color: FALLBACK_RUNTIME_COLOR_INK_500,
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
    isRuntimeSelectable(currentRuntimeId)
  ) {
    return RUNTIMES;
  }

  return [...RUNTIMES, createExternalRuntimeInfo(currentRuntimeId)];
}

export function isRuntimeSelectable(runtimeId: string): boolean {
  return getRuntimeCatalogEntry(runtimeId) !== null;
}

export function getRuntimeInfo(id: string): RuntimeInfo {
  const runtime = listRuntimeOptions(id).find((candidate) => candidate.id === id);

  if (!runtime) {
    throw new Error(`Unknown runtime: ${id}.`);
  }

  return runtime;
}
