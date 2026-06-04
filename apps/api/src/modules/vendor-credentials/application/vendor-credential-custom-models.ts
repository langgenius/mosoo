import { isTruthy } from "../../../shared/truthiness";
import { parseCredentialModels } from "./vendor-credential.mapper";
import type { VendorCredentialRow } from "./vendor-credential.types";
export interface CustomCredentialModelRow {
  modelId: string;
  row: VendorCredentialRow;
}

function credentialModelPriority(row: VendorCredentialRow): number {
  if (Boolean(row.ownerUserId) && row.isPreferred === 1) {
    return 0;
  }

  if (isTruthy(row.ownerUserId)) {
    return 1;
  }

  if (row.isDefault === 1) {
    return 2;
  }

  return 3;
}

function compareCredentialRows(left: VendorCredentialRow, right: VendorCredentialRow): number {
  const priority = credentialModelPriority(left) - credentialModelPriority(right);

  if (priority !== 0) {
    return priority;
  }

  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

export function listEffectiveCustomCredentialModelRows(
  rows: readonly VendorCredentialRow[],
): CustomCredentialModelRow[] {
  const entries: CustomCredentialModelRow[] = [];
  const seenModelIds = new Set<string>();

  for (const row of [...rows].toSorted(compareCredentialRows)) {
    for (const modelId of parseCredentialModels(row.modelsJson) ?? []) {
      if (seenModelIds.has(modelId)) {
        continue;
      }

      seenModelIds.add(modelId);
      entries.push({ modelId, row });
    }
  }

  return entries;
}

export function findCustomCredentialRowForModel(
  rows: readonly VendorCredentialRow[],
  modelId: string,
): VendorCredentialRow | null {
  return (
    listEffectiveCustomCredentialModelRows(rows).find((entry) => entry.modelId === modelId)?.row ??
    null
  );
}
