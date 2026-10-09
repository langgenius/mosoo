import { publicApiRateLimitWindowsTable } from "@mosoo/db";
import { lt, sql } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import { currentTimestampMs } from "../../time";
import { publicRateLimited } from "./public-api-errors";

export const PUBLIC_API_RATE_LIMIT_WINDOW_MS = 60_000;
export const PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE = 120;
export const PUBLIC_API_RATE_LIMIT_RETENTION_MS = PUBLIC_API_RATE_LIMIT_WINDOW_MS * 5;

function getWindowStart(timestampMs: number): number {
  return (
    Math.floor(timestampMs / PUBLIC_API_RATE_LIMIT_WINDOW_MS) * PUBLIC_API_RATE_LIMIT_WINDOW_MS
  );
}

function getRetryAfterSeconds(windowStartMs: number, nowMs: number): number {
  const retryAfterMs = windowStartMs + PUBLIC_API_RATE_LIMIT_WINDOW_MS - nowMs;
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

export async function enforcePublicApiRateLimit(
  database: D1Database,
  tokenId: string,
  nowMs = currentTimestampMs(),
): Promise<void> {
  const windowStart = getWindowStart(nowMs);
  const window = await getAppDatabase(database)
    .insert(publicApiRateLimitWindowsTable)
    .values({
      bucketKey: `public_api:${tokenId}`,
      requestCount: 1,
      shard: 0,
      updatedAt: nowMs,
      windowStart,
    })
    .onConflictDoUpdate({
      set: {
        requestCount: sql`${publicApiRateLimitWindowsTable.requestCount} + 1`,
        updatedAt: nowMs,
      },
      target: [
        publicApiRateLimitWindowsTable.bucketKey,
        publicApiRateLimitWindowsTable.windowStart,
        publicApiRateLimitWindowsTable.shard,
      ],
    })
    .returning({ requestCount: publicApiRateLimitWindowsTable.requestCount })
    .get();

  if (window !== undefined && window.requestCount <= PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE) {
    return;
  }

  throw publicRateLimited(getRetryAfterSeconds(windowStart, nowMs));
}

export async function cleanupPublicApiRateLimitWindows(
  database: D1Database,
  nowMs = currentTimestampMs(),
): Promise<void> {
  await getAppDatabase(database)
    .delete(publicApiRateLimitWindowsTable)
    .where(lt(publicApiRateLimitWindowsTable.updatedAt, nowMs - PUBLIC_API_RATE_LIMIT_RETENTION_MS))
    .run();
}
