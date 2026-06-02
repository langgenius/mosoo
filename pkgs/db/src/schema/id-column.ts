import type { PlatformId } from "@mosoo/id";
import { customType } from "drizzle-orm/sqlite-core";

const PLATFORM_ID_SQL_GLOB_PATTERN = `[0-7]${"[0-9A-HJKMNP-TV-Z]".repeat(25)}`;

type PlatformIdColumnBuilder<TId extends PlatformId> = ReturnType<
  ReturnType<typeof customType<{ data: TId; driverData: string }>>
>;

interface PlatformIdColumn {
  <TId extends PlatformId>(
    name: string,
    narrow?: (id: PlatformId) => TId,
  ): PlatformIdColumnBuilder<TId>;
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function platformIdColumnValue(name: string): PlatformIdColumnBuilder<PlatformId> {
  const quotedName = quoteSqliteIdentifier(name);
  const platformIdText = customType<{ data: PlatformId; driverData: string }>({
    dataType() {
      return `text CHECK (${quotedName} = upper(${quotedName}) AND length(${quotedName}) = 26 AND ${quotedName} GLOB '${PLATFORM_ID_SQL_GLOB_PATTERN}')`;
    },
  });

  return platformIdText(name);
}

export const platformIdColumn = platformIdColumnValue as PlatformIdColumn;
