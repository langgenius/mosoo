import type { ResolvedModelEntry } from "../../../../domains/vendor-credential/api/vendor-credential-client";

export function listLockedVendorLabels(entries: ResolvedModelEntry[]): string[] {
  const labels = new Set<string>();

  for (const entry of entries) {
    if (!entry.available && entry.reason === "needs-key") {
      labels.add(entry.vendorLabel);
    }
  }

  return [...labels];
}

export function findCurrentModelEntry(
  entries: readonly ResolvedModelEntry[],
  currentModelId: string | null,
  currentVendorId: string | null,
): ResolvedModelEntry | null {
  if (currentModelId === null) {
    return null;
  }

  return (
    entries.find(
      (entry) => entry.modelId === currentModelId && entry.vendorId === currentVendorId,
    ) ??
    entries.find((entry) => entry.modelId === currentModelId) ??
    null
  );
}

export function listModelPickerEntries(
  entries: readonly ResolvedModelEntry[],
  currentModelId: string | null,
  currentVendorId: string | null,
): ResolvedModelEntry[] {
  const availableEntries = entries.filter((entry) => entry.available);
  const currentEntry = findCurrentModelEntry(entries, currentModelId, currentVendorId);

  if (currentEntry === null || currentEntry.available) {
    return availableEntries;
  }

  return [
    currentEntry,
    ...availableEntries.filter(
      (entry) => entry.modelId !== currentEntry.modelId || entry.vendorId !== currentEntry.vendorId,
    ),
  ];
}
