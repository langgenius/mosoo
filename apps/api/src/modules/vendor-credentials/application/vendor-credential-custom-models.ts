import { parseCredentialModels } from "./vendor-credential.mapper";
import type { VendorCredentialRow } from "./vendor-credential.types";
export interface CustomCredentialModelRow {
  modelId: string;
  row: VendorCredentialRow;
}

function compareCredentialRows(left: VendorCredentialRow, right: VendorCredentialRow): number {
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
  for (const row of [...rows].toSorted(compareCredentialRows)) {
    if ((parseCredentialModels(row.modelsJson) ?? []).includes(modelId)) {
      return row;
    }
  }

  return null;
}
