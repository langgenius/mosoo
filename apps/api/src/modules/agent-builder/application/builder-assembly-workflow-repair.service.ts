import type {
  AgentBuilderToolExecutionRecord,
  AgentBuilderToolId,
  AgentBuilderToolPayload,
} from "@mosoo/contracts/agent-builder";
import type { AgentBuilderPlannerRunId } from "@mosoo/id";

import type { AgentBuilderToolRuntime } from "./agent-builder-tool-runtime.service";
import {
  PREPARE_BIND_TOOL_IDS,
  displayAssetType,
  findResolvedAssetForFailedPrepareBind,
  isRecord,
  listAmbiguousAssetReferences,
  listResolvedAssetReferences,
  nodeKeyPart,
  normalizeSearchText,
  outputStatus,
  readBindableAssetType,
  readString,
  recordOutput,
} from "./builder-assembly-workflow-repair-assets";
import type {
  AmbiguousAssetReferences,
  ResolvedAssetReference,
} from "./builder-assembly-workflow-repair-assets";

interface WorkflowRepairResult {
  readonly result: unknown;
  readonly trace: AgentBuilderToolExecutionRecord[];
}

interface RepairedStarterPackItems {
  readonly items: unknown[];
  readonly singleChoiceCount: number;
  readonly repairedCount: number;
}

function itemText(item: Record<string, unknown>): string {
  return normalizeSearchText(
    [
      readString(item["nodeKey"]),
      readString(item["title"]),
      readString(item["reason"]),
      readString(item["assetId"]),
      readString(item["assetName"]),
    ]
      .filter((value): value is string => value !== null)
      .join(" "),
  );
}

function itemNeedsExistingAssetBindingRepair(item: Record<string, unknown>): boolean {
  const action = isRecord(item["action"]) ? item["action"] : null;

  if (action?.["type"] === "bind_existing_asset") {
    return false;
  }

  if (item["status"] === "applied" && action?.["type"] === "none") {
    return true;
  }

  return (
    item["status"] === "needs_config" ||
    item["approvalMode"] === "external_config" ||
    action?.["type"] === "open_external_setup"
  );
}

function findResolvedAssetForItem(
  item: Record<string, unknown>,
  resolvedAssets: readonly ResolvedAssetReference[],
): ResolvedAssetReference | null {
  const assetType = readBindableAssetType(item["assetType"]);

  if (assetType === null || !itemNeedsExistingAssetBindingRepair(item)) {
    return null;
  }

  const sameTypeAssets = resolvedAssets.filter((asset) => asset.assetType === assetType);

  if (sameTypeAssets.length === 0) {
    return null;
  }

  if (sameTypeAssets.length === 1) {
    return sameTypeAssets[0] ?? null;
  }

  const text = itemText(item);

  return (
    sameTypeAssets.find((asset) => {
      const name = normalizeSearchText(asset.name);
      const id = normalizeSearchText(asset.id);

      return text.includes(name) || text.includes(id);
    }) ?? null
  );
}

function findAmbiguousCandidatesForItem(
  item: Record<string, unknown>,
  ambiguousReferences: readonly AmbiguousAssetReferences[],
): ResolvedAssetReference[] {
  const assetType = readBindableAssetType(item["assetType"]);

  if (assetType === null || !itemNeedsExistingAssetBindingRepair(item)) {
    return [];
  }

  const sameTypeReferences = ambiguousReferences.filter(
    (reference) => reference.assetType === assetType,
  );

  if (sameTypeReferences.length === 0) {
    return [];
  }

  if (sameTypeReferences.length === 1) {
    return sameTypeReferences[0]?.candidates ?? [];
  }

  const text = itemText(item);
  const matchingReference = sameTypeReferences.find((reference) => {
    const referenceText =
      reference.referenceText === undefined ? "" : normalizeSearchText(reference.referenceText);

    return referenceText.length > 0 && text.includes(referenceText);
  });

  return matchingReference?.candidates ?? [];
}

async function executeRepairTool(input: {
  payload: AgentBuilderToolPayload;
  toolId: AgentBuilderToolId;
  tools: AgentBuilderToolRuntime;
  trace: AgentBuilderToolExecutionRecord[];
}): Promise<AgentBuilderToolExecutionRecord | null> {
  const record = await input.tools.execute({
    input: input.payload,
    toolId: input.toolId,
  });

  input.trace.push(record);

  return record.status === "completed" && record.output !== null ? record : null;
}

async function createBindPatchFromResolvedAsset(input: {
  item: Record<string, unknown>;
  resolvedAsset: ResolvedAssetReference;
  tools: AgentBuilderToolRuntime;
  trace: AgentBuilderToolExecutionRecord[];
}): Promise<Record<string, unknown> | null> {
  const prepareToolId = PREPARE_BIND_TOOL_IDS[input.resolvedAsset.assetType];
  const baseNodeKey = readString(input.item["nodeKey"]) ?? `bind_${input.resolvedAsset.id}`;

  if (input.resolvedAsset.bindingState === "bound") {
    return {
      ...input.item,
      action: {
        type: "none",
      },
      approvalMode: "blocked",
      assetId: input.resolvedAsset.id,
      assetName: input.resolvedAsset.name,
      assetType: input.resolvedAsset.assetType,
      evidenceRefs: [`resolve_asset_reference:${input.resolvedAsset.id}`],
      nodeKey: baseNodeKey,
      reason: `${displayAssetType(input.resolvedAsset.assetType)} ${input.resolvedAsset.name} 已经绑定到当前 Agent Draft，无需再次确认。`,
      status: "applied",
      title: `已绑定 ${displayAssetType(input.resolvedAsset.assetType)}：${input.resolvedAsset.name}`,
    };
  }

  const bindNodeKey = `${baseNodeKey}_bind_existing`;
  const prepareRecord = await executeRepairTool({
    payload: {
      assetId: input.resolvedAsset.id,
      assetName: input.resolvedAsset.name,
      nodeKey: bindNodeKey,
    },
    toolId: prepareToolId,
    tools: input.tools,
    trace: input.trace,
  });

  if (prepareRecord === null || outputStatus(prepareRecord) !== "ready") {
    return null;
  }

  const dryRunRecord = await executeRepairTool({
    payload: {
      nodes: recordOutput(prepareRecord)?.["nodes"],
    },
    toolId: "dry_run_draft_patch",
    tools: input.tools,
    trace: input.trace,
  });

  if (dryRunRecord === null || outputStatus(dryRunRecord) !== "passed") {
    return null;
  }

  return {
    ...input.item,
    action: {
      assetId: input.resolvedAsset.id,
      type: "bind_existing_asset",
    },
    approvalMode: "single_or_batch",
    assetId: input.resolvedAsset.id,
    assetName: input.resolvedAsset.name,
    assetType: input.resolvedAsset.assetType,
    evidenceRefs: [
      `resolve_asset_reference:${input.resolvedAsset.id}`,
      `${prepareToolId}:${input.resolvedAsset.id}`,
      `dry_run_draft_patch:${input.resolvedAsset.id}`,
    ],
    nodeKey: baseNodeKey,
    reason: `已从可见资产中解析到 ${displayAssetType(input.resolvedAsset.assetType)} ${input.resolvedAsset.name}，准备绑定到当前 Agent Draft。`,
    status: "pending",
    title: `绑定现有 ${displayAssetType(input.resolvedAsset.assetType)}：${input.resolvedAsset.name}`,
  };
}

async function createSingleChoiceBindItemsFromCandidates(input: {
  candidates: readonly ResolvedAssetReference[];
  item: Record<string, unknown>;
  tools: AgentBuilderToolRuntime;
  trace: AgentBuilderToolExecutionRecord[];
}): Promise<Record<string, unknown>[]> {
  const baseNodeKey = readString(input.item["nodeKey"]) ?? "choose_existing_asset";
  const items: Record<string, unknown>[] = [];

  for (const candidate of input.candidates) {
    const repairedItem = await createBindPatchFromResolvedAsset({
      item: {
        ...input.item,
        nodeKey: `${baseNodeKey}_${candidate.id}`,
      },
      resolvedAsset: candidate,
      tools: input.tools,
      trace: input.trace,
    });

    if (repairedItem === null) {
      continue;
    }

    items.push({
      ...repairedItem,
      ...(repairedItem["status"] === "pending" ? { approvalMode: "single_only" } : {}),
      reason: `找到多个可能匹配的 ${displayAssetType(candidate.assetType)}，请选择 ${candidate.name} 后再绑定到当前 Agent Draft。`,
      title:
        repairedItem["status"] === "pending"
          ? `使用 ${displayAssetType(candidate.assetType)}：${candidate.name}`
          : repairedItem["title"],
    });
  }

  return items;
}

async function repairStarterPackItems(input: {
  items: readonly unknown[];
  tools: AgentBuilderToolRuntime;
  trace: AgentBuilderToolExecutionRecord[];
}): Promise<RepairedStarterPackItems> {
  const resolvedAssets = listResolvedAssetReferences(input.trace);
  const ambiguousReferences = listAmbiguousAssetReferences(input.trace);
  const repairedItems: unknown[] = [];
  let singleChoiceCount = 0;
  let repairedCount = 0;

  for (const item of input.items) {
    if (!isRecord(item)) {
      repairedItems.push(item);
      continue;
    }

    const resolvedAsset = findResolvedAssetForItem(item, resolvedAssets);

    if (resolvedAsset !== null) {
      const repairedItem = await createBindPatchFromResolvedAsset({
        item,
        resolvedAsset,
        tools: input.tools,
        trace: input.trace,
      });

      if (repairedItem !== null) {
        repairedCount += 1;
      }

      repairedItems.push(repairedItem ?? item);
      continue;
    }

    const candidateItems = await createSingleChoiceBindItemsFromCandidates({
      candidates: findAmbiguousCandidatesForItem(item, ambiguousReferences),
      item,
      tools: input.tools,
      trace: input.trace,
    });

    if (candidateItems.length === 0) {
      repairedItems.push(item);
      continue;
    }

    singleChoiceCount += candidateItems.length;
    repairedCount += candidateItems.length;
    repairedItems.push(...candidateItems);
  }

  return {
    items: repairedItems,
    singleChoiceCount,
    repairedCount,
  };
}

async function repairFailedResolvedAssetBinding(input: {
  plannerRunId: AgentBuilderPlannerRunId;
  tools: AgentBuilderToolRuntime;
  trace: AgentBuilderToolExecutionRecord[];
}): Promise<Record<string, unknown> | null> {
  const resolvedAssets = listResolvedAssetReferences(input.trace);

  for (const record of input.trace) {
    const resolvedAsset = findResolvedAssetForFailedPrepareBind(record, resolvedAssets);

    if (resolvedAsset === null) {
      continue;
    }

    const repairedItem = await createBindPatchFromResolvedAsset({
      item: {
        assetType: resolvedAsset.assetType,
        nodeKey: `bind_${resolvedAsset.assetType}_${resolvedAsset.id}`,
      },
      resolvedAsset,
      tools: input.tools,
      trace: input.trace,
    });

    if (repairedItem === null) {
      continue;
    }

    const status = readString(repairedItem["status"]);
    const assistantText =
      status === "applied"
        ? "该资产已经绑定到当前 Agent Draft，无需重复确认。"
        : "我已找到可绑定的现有资产，并准备绑定到当前 Agent Draft。请确认后应用。";

    return {
      assistantText,
      intentSummary: `Bind existing ${resolvedAsset.assetType} ${resolvedAsset.name} to the Agent Draft.`,
      items: [repairedItem],
      mode: "starter_pack",
      plannerRunId: input.plannerRunId,
      version: 1,
    };
  }

  return null;
}

async function repairAmbiguousAssetBinding(input: {
  plannerRunId: AgentBuilderPlannerRunId;
  tools: AgentBuilderToolRuntime;
  trace: AgentBuilderToolExecutionRecord[];
}): Promise<Record<string, unknown> | null> {
  const ambiguousReferences = listAmbiguousAssetReferences(input.trace);

  for (const ambiguousReference of ambiguousReferences) {
    const referencePart =
      ambiguousReference.referenceText === undefined
        ? ambiguousReference.assetType
        : nodeKeyPart(ambiguousReference.referenceText);
    const items = await createSingleChoiceBindItemsFromCandidates({
      candidates: ambiguousReference.candidates,
      item: {
        action: {
          type: "none",
        },
        approvalMode: "external_config",
        assetType: ambiguousReference.assetType,
        nodeKey: `choose_${ambiguousReference.assetType}_${referencePart}`,
        reason: `找到多个可能匹配的 ${displayAssetType(ambiguousReference.assetType)}。`,
        status: "needs_config",
        title: `选择 ${displayAssetType(ambiguousReference.assetType)}`,
      },
      tools: input.tools,
      trace: input.trace,
    });

    if (items.length === 0) {
      continue;
    }

    return {
      assistantText: "我找到了多个可能匹配的现有资产，请选择一个确认后绑定到当前 Agent Draft。",
      intentSummary: `Choose one existing ${ambiguousReference.assetType} to bind to the Agent Draft.`,
      items,
      mode: "starter_pack",
      plannerRunId: input.plannerRunId,
      version: 1,
    };
  }

  return null;
}

export async function repairAgentBuilderAssemblyWorkflowResult(input: {
  readonly plannerRunId: AgentBuilderPlannerRunId;
  readonly result: unknown;
  readonly tools: AgentBuilderToolRuntime;
  readonly trace: readonly AgentBuilderToolExecutionRecord[];
}): Promise<WorkflowRepairResult> {
  const trace = [...input.trace];

  if (!isRecord(input.result) || !Array.isArray(input.result["items"])) {
    const repairedResult = await repairFailedResolvedAssetBinding({
      plannerRunId: input.plannerRunId,
      tools: input.tools,
      trace,
    });
    const ambiguousResult =
      repairedResult === null
        ? await repairAmbiguousAssetBinding({
            plannerRunId: input.plannerRunId,
            tools: input.tools,
            trace,
          })
        : null;

    return {
      result: repairedResult ?? ambiguousResult ?? input.result,
      trace,
    };
  }

  const repairedItems = await repairStarterPackItems({
    items: input.result["items"],
    tools: input.tools,
    trace,
  });

  return {
    result: {
      ...input.result,
      ...(repairedItems.repairedCount > 0
        ? {
            assistantText:
              repairedItems.singleChoiceCount > 0
                ? "我找到了多个可能匹配的现有资产，请选择一个确认后绑定到当前 Agent Draft。"
                : "我已找到可绑定的现有资产，并准备绑定到当前 Agent Draft。请确认后应用。",
          }
        : {}),
      items: repairedItems.items,
    },
    trace,
  };
}
