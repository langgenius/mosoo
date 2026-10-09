import type { PlatformId } from "@mosoo/id";
import { customType } from "drizzle-orm/sqlite-core";

const PLATFORM_ID_SQL_ALLOWED_CHARS_GLOB_PATTERN = "*[^0-9A-HJKMNP-TV-Z]*";

function quoteSqliteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

// The caller chooses the semantic ID brand stored in the column.
// eslint-disable-next-line typescript/no-unnecessary-type-parameters
export function platformIdColumn<TId extends PlatformId>(name: string) {
  const quotedName = quoteSqliteIdentifier(name);
  const platformIdText = customType<{ data: TId; driverData: string }>({
    dataType() {
      return `text CHECK (${quotedName} = upper(${quotedName}) AND length(${quotedName}) = 26 AND substr(${quotedName}, 1, 1) GLOB '[0-7]' AND ${quotedName} NOT GLOB '${PLATFORM_ID_SQL_ALLOWED_CHARS_GLOB_PATTERN}')`;
    },
  });

  return platformIdText(name);
}
