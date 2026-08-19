import type { HarnessCatalogEntry, HarnessSlug } from "@mosoo/contracts/harness";

import { getRuntimeCatalogEntry } from "./runtime-catalog";

const HARNESS_VERSION = "2026.08-experiment.1";

interface HarnessDefinition {
  capabilities: HarnessCatalogEntry["capabilities"];
  description: string;
  label: string;
  runtimeId: string;
  slug: HarnessSlug;
}

const HARNESS_DEFINITIONS: readonly HarnessDefinition[] = [
  {
    capabilities: {
      approve: "normalized",
      artifacts: "normalized",
      cancel: "normalized",
      resume: "normalized",
      stream: "normalized",
      subagents: "native",
    },
    description: "Claude Code through the Claude Agent SDK, normalized as a Mosoo Run.",
    label: "Claude Code",
    runtimeId: "claude-agent-sdk",
    slug: "claude-code",
  },
  {
    capabilities: {
      approve: "normalized",
      artifacts: "normalized",
      cancel: "normalized",
      resume: "normalized",
      stream: "normalized",
      subagents: "native",
    },
    description: "OpenAI Codex app-server execution, normalized as a Mosoo Run.",
    label: "OpenAI Codex",
    runtimeId: "openai-runtime",
    slug: "openai-codex",
  },
  {
    capabilities: {
      approve: "normalized",
      artifacts: "normalized",
      cancel: "normalized",
      resume: "normalized",
      stream: "normalized",
      subagents: "unsupported",
    },
    description: "OpenCode over ACP, normalized as a Mosoo Run.",
    label: "OpenCode",
    runtimeId: "acp-fallback",
    slug: "opencode",
  },
] as const;

function createHarnessCatalogEntry(definition: HarnessDefinition): HarnessCatalogEntry {
  const runtime = getRuntimeCatalogEntry(definition.runtimeId);

  if (runtime === null) {
    throw new Error(
      `Harness ${definition.slug} references unknown runtime ${definition.runtimeId}.`,
    );
  }

  const supportedModels = runtime.supportedModelIds ?? [runtime.defaultModel];

  return {
    capabilities: definition.capabilities,
    defaultModel: runtime.defaultModel,
    description: definition.description,
    environment: {
      default: "workspace",
      repositoryRequired: false,
    },
    label: definition.label,
    quickstart: `await mosoo.run({ harness: "${definition.slug}", input: "Describe this project" })`,
    requiredCredentials: runtime.vendors.map((vendor) => vendor.vendorId),
    runtimeId: runtime.runtimeId,
    slug: definition.slug,
    status: runtime.disabledReason === undefined ? "available" : "unavailable",
    supportedModels,
    version: HARNESS_VERSION,
  };
}

export const HARNESS_CATALOG: readonly HarnessCatalogEntry[] =
  HARNESS_DEFINITIONS.map(createHarnessCatalogEntry);

export function listHarnessCatalog(): readonly HarnessCatalogEntry[] {
  return HARNESS_CATALOG;
}

export function getHarnessCatalogEntry(slug: string): HarnessCatalogEntry | null {
  return HARNESS_CATALOG.find((entry) => entry.slug === slug) ?? null;
}
