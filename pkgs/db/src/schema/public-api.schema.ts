import type { PlatformId } from "@mosoo/id";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const publicApiIdempotencyKeysTable = sqliteTable(
  "public_api_idempotency_key",
  {
    bodyHash: text("body_hash"),
    createdAt: integer("created_at").notNull(),
    id: platformIdColumn<PlatformId>("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    method: text("method").notNull(),
    responseJson: text("response_json"),
    responseStatus: integer("response_status"),
    route: text("route").notNull(),
    tokenId: platformIdColumn<PlatformId>("token_id").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("public_api_idempotency_token_key_idx").on(table.tokenId, table.idempotencyKey),
    index("public_api_idempotency_updated_idx").on(table.updatedAt),
  ],
);

export const publicApiRateLimitWindowsTable = sqliteTable(
  "public_api_rate_limit_window",
  {
    bucketKey: text("bucket_key").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    shard: integer("shard").notNull(),
    updatedAt: integer("updated_at").notNull(),
    windowStart: integer("window_start").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.bucketKey, table.windowStart, table.shard],
    }),
    index("public_api_rate_limit_window_updated_idx").on(table.updatedAt),
  ],
);

export type PublicApiIdempotencyKeyRow = typeof publicApiIdempotencyKeysTable.$inferSelect;
export type PublicApiRateLimitWindowRow = typeof publicApiRateLimitWindowsTable.$inferSelect;
