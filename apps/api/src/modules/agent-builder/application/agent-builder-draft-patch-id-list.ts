import type { AgentBuilderDraftPatchValue } from "@mosoo/contracts/agent-builder";

export function normalizeDraftPatchIdList(value: AgentBuilderDraftPatchValue): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Agent Builder draft_patch binding value must be an array of IDs.");
  }

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const rawId of value) {
    const id = rawId.trim();

    if (id.length === 0 || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export function appendUniqueDraftPatchIds(
  currentIds: readonly string[],
  idsToAppend: readonly string[],
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const id of currentIds) {
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  for (const id of idsToAppend) {
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}
