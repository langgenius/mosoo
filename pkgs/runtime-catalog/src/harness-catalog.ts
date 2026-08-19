import type {
  HarnessCatalogEntry,
  HarnessProfileBenchmarkRecord,
  HarnessProfileVersion,
  HarnessSlug,
} from "@mosoo/contracts/harness";

import { getRuntimeCatalogEntry } from "./runtime-catalog";

const MOSOO_HARNESS_VERSION = "2026.08-experiment.2";
const MOSOO_PROFILE_VERSION = "2026.08-experiment.2";
const MOSOO_ADAPTER_REVISION = "4e834acc7ef873b4dc884ecea42c7651f808e0c0";
const MOSOO_SOURCE = "https://github.com/langgenius/mosoo";
const DEEPSEEK_HARNESS_REVISION = "141eb6fef83422698aef7a981029e843e8161534";
const DEEPSEEK_HARNESS_VERSION = "0.1.0-rc.8";
const DEEPSEEK_HARNESS_SOURCE = "https://github.com/deepseek-ai/deepseek-harness";

const BENCHMARK_SUITE_ID = "harness-profile-repository-review-v1";
const BENCHMARK_TASK_ID = "highest-severity-correctness-risk-v1";
const BENCHMARK_TASK_DIGEST =
  "sha256:9e039ca7afa9c66eaee63d80e63a3e50616fe0ac4bc3561f5f2e23f764ed4e37";

interface RuntimeBackedHarnessDefinition {
  capabilities: HarnessCatalogEntry["capabilities"];
  description: string;
  label: string;
  profileDescription: string;
  profileId: string;
  profileLabel: string;
  runtimeId: string;
  slug: Exclude<HarnessSlug, "deepseek-harness">;
}

const RUNTIME_BACKED_HARNESSES: readonly RuntimeBackedHarnessDefinition[] = [
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
    profileDescription:
      "Locked Mosoo baseline for the Claude Agent SDK with Cattle isolation and Workspace policy.",
    profileId: "claude-code/mosoo-baseline",
    profileLabel: "Mosoo baseline",
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
    profileDescription:
      "Locked Mosoo baseline for Codex app-server with Cattle isolation and Workspace policy.",
    profileId: "openai-codex/mosoo-baseline",
    profileLabel: "Mosoo baseline",
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
    profileDescription:
      "Locked Mosoo baseline for OpenCode over ACP with Cattle isolation and Workspace policy.",
    profileId: "opencode/mosoo-baseline",
    profileLabel: "Mosoo baseline",
    runtimeId: "acp-fallback",
    slug: "opencode",
  },
] as const;

function createBenchmarkRecord(input: {
  model: string;
  status: HarnessProfileBenchmarkRecord["status"];
}): HarnessProfileBenchmarkRecord {
  return {
    model: input.model,
    result: null,
    status: input.status,
    suiteId: BENCHMARK_SUITE_ID,
    taskDigest: BENCHMARK_TASK_DIGEST,
    taskId: BENCHMARK_TASK_ID,
  };
}

function createProfile(input: {
  benchmarkStatus: HarnessProfileBenchmarkRecord["status"];
  defaultModel: string;
  description: string;
  environmentRequirements: readonly string[];
  id: string;
  label: string;
  provenanceRevision: string;
  provenanceSource: string;
  runtimeId: string;
  status: HarnessProfileVersion["status"];
  version: string;
}): HarnessProfileVersion {
  return {
    benchmark: createBenchmarkRecord({
      model: input.defaultModel,
      status: input.benchmarkStatus,
    }),
    defaultModel: input.defaultModel,
    description: input.description,
    environmentRequirements: input.environmentRequirements,
    id: input.id,
    label: input.label,
    provenance: {
      revision: input.provenanceRevision,
      source: input.provenanceSource,
    },
    reference: `${input.id}@${input.version}`,
    runtimeId: input.runtimeId,
    status: input.status,
    trust: {
      composition: "locked",
      execution: "shell-equivalent",
      isolation: "cattle",
    },
    version: input.version,
  };
}

function createRuntimeBackedHarness(
  definition: RuntimeBackedHarnessDefinition,
): HarnessCatalogEntry {
  const runtime = getRuntimeCatalogEntry(definition.runtimeId);

  if (runtime === null) {
    throw new Error(
      `Harness ${definition.slug} references unknown runtime ${definition.runtimeId}.`,
    );
  }

  const supportedModels = runtime.supportedModelIds ?? [runtime.defaultModel];
  const status = runtime.disabledReason === undefined ? "available" : "unavailable";
  const benchmarkStatus =
    definition.slug === "openai-codex" || definition.slug === "opencode"
      ? "contract_smoke"
      : "not_run";
  const profile = createProfile({
    benchmarkStatus,
    defaultModel: runtime.defaultModel,
    description: definition.profileDescription,
    environmentRequirements: [
      "Mosoo Cattle Sandbox",
      "Frozen Workspace Environment revision",
      ...runtime.vendors.map((vendor) => `${vendor.vendorId} provider credential`),
    ],
    id: definition.profileId,
    label: definition.profileLabel,
    provenanceRevision: MOSOO_ADAPTER_REVISION,
    provenanceSource: MOSOO_SOURCE,
    runtimeId: runtime.runtimeId,
    status,
    version: MOSOO_PROFILE_VERSION,
  });

  return {
    capabilities: definition.capabilities,
    defaultModel: runtime.defaultModel,
    defaultProfile: profile.reference,
    description: definition.description,
    environment: {
      default: "workspace",
      repositoryRequired: false,
    },
    label: definition.label,
    profiles: [profile],
    quickstart: `await mosoo.run({ harness: "${definition.slug}", profile: "${profile.reference}", input: "Describe this project" })`,
    requiredCredentials: runtime.vendors.map((vendor) => vendor.vendorId),
    runtimeId: runtime.runtimeId,
    slug: definition.slug,
    status,
    supportedModels,
    unavailableReason: runtime.disabledReason ?? null,
    version: MOSOO_HARNESS_VERSION,
  };
}

function createDeepSeekHarness(): HarnessCatalogEntry {
  const profile = createProfile({
    benchmarkStatus: "not_run",
    defaultModel: "deepseek-v4-flash",
    description:
      "DeepSeek Harness headless distribution with its base and headless bundles locked as one composition.",
    environmentRequirements: [
      "Node.js ^22.19.0 or >=24.0.0",
      "Mosoo Cattle Sandbox",
      "Frozen Workspace Environment revision",
      "DeepSeek provider credential",
    ],
    id: "deepseek-harness/headless",
    label: "Headless distribution",
    provenanceRevision: DEEPSEEK_HARNESS_REVISION,
    provenanceSource: DEEPSEEK_HARNESS_SOURCE,
    runtimeId: "deepseek-harness",
    status: "unavailable",
    version: DEEPSEEK_HARNESS_VERSION,
  });

  return {
    capabilities: {
      approve: "unsupported",
      artifacts: "unsupported",
      cancel: "unsupported",
      resume: "unsupported",
      stream: "unsupported",
      subagents: "unsupported",
    },
    defaultModel: profile.defaultModel,
    defaultProfile: profile.reference,
    description:
      "DeepSeek Harness as one locked distribution; its internal Cordis plugin graph is not a Marketplace SKU surface.",
    environment: {
      default: "workspace",
      repositoryRequired: false,
    },
    label: "DeepSeek Harness",
    profiles: [profile],
    quickstart: `// unavailable: await mosoo.run({ harness: "deepseek-harness", profile: "${profile.reference}", input: "Describe this project" })`,
    requiredCredentials: ["deepseek"],
    runtimeId: profile.runtimeId,
    slug: "deepseek-harness",
    status: "unavailable",
    supportedModels: [profile.defaultModel],
    unavailableReason:
      "The locked distribution has no Mosoo Driver adapter or measured normalized-Run benchmark yet.",
    version: DEEPSEEK_HARNESS_VERSION,
  };
}

export const HARNESS_CATALOG: readonly HarnessCatalogEntry[] = [
  ...RUNTIME_BACKED_HARNESSES.map(createRuntimeBackedHarness),
  createDeepSeekHarness(),
];

export function listHarnessCatalog(): readonly HarnessCatalogEntry[] {
  return HARNESS_CATALOG;
}

export function getHarnessCatalogEntry(slug: string): HarnessCatalogEntry | null {
  return HARNESS_CATALOG.find((entry) => entry.slug === slug) ?? null;
}

export function getHarnessProfileVersion(
  harnessSlug: string,
  reference?: string,
): HarnessProfileVersion | null {
  const harness = getHarnessCatalogEntry(harnessSlug);

  if (harness === null) {
    return null;
  }

  const resolvedReference = reference ?? harness.defaultProfile;
  return harness.profiles.find((profile) => profile.reference === resolvedReference) ?? null;
}
