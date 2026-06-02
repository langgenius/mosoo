import type { PrimitiveRecord } from "@mosoo/contracts";

export function parseChannelDisplayMetadata(value: string): PrimitiveRecord {
  const parsed: unknown = JSON.parse(value);

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Channel binding display metadata must be an object.");
  }

  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, PrimitiveRecord[string]] => {
      const metadataValue = entry[1];
      return (
        typeof metadataValue === "string" ||
        typeof metadataValue === "number" ||
        typeof metadataValue === "boolean" ||
        metadataValue === null
      );
    }),
  );
}
