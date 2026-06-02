import { publicApiRateLimitWindowsTable } from "@mosoo/db";
import { and, eq, lt, sql, sum } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import { currentTimestampMs } from "../../time";
import { publicRateLimited } from "./published-agent-api-errors";

export const PUBLIC_API_RATE_LIMIT_WINDOW_MS = 60_000;
export const PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE = 120;
export const PUBLIC_API_RATE_LIMIT_RETENTION_MS = PUBLIC_API_RATE_LIMIT_WINDOW_MS * 5;
const PUBLIC_API_RATE_LIMIT_SHARD_COUNT = 16;

function getWindowStart(timestampMs: number): number {
  return (
    Math.floor(timestampMs / PUBLIC_API_RATE_LIMIT_WINDOW_MS) * PUBLIC_API_RATE_LIMIT_WINDOW_MS
  );
}

function getRetryAfterSeconds(windowStartMs: number, nowMs: number): number {
  const retryAfterMs = windowStartMs + PUBLIC_API_RATE_LIMIT_WINDOW_MS - nowMs;
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

function getBucketKey(tokenId: string): string {
  return `public_api:${tokenId}`;
}

function chooseRateLimitShard(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] ?? 0) % PUBLIC_API_RATE_LIMIT_SHARD_COUNT;
}

async function incrementRateLimitWindow(input: {
  bucketKey: string;
  database: D1Database;
  nowMs: number;
  windowStart: number;
}): Promise<{ requestCount: number; windowStart: number }> {
  const shard = chooseRateLimitShard();

  await getAppDatabase(input.database)
    .insert(publicApiRateLimitWindowsTable)
    .values({
      bucketKey: input.bucketKey,
      requestCount: 1,
      shard,
      updatedAt: input.nowMs,
      windowStart: input.windowStart,
    })
    .onConflictDoUpdate({
      set: {
        requestCount: sql`${publicApiRateLimitWindowsTable.requestCount} + 1`,
        updatedAt: input.nowMs,
      },
      target: [
        publicApiRateLimitWindowsTable.bucketKey,
        publicApiRateLimitWindowsTable.windowStart,
        publicApiRateLimitWindowsTable.shard,
      ],
    })
    .run();

  const row =
    (await getAppDatabase(input.database)
      .select({ requestCount: sum(publicApiRateLimitWindowsTable.requestCount) })
      .from(publicApiRateLimitWindowsTable)
      .where(
        and(
          eq(publicApiRateLimitWindowsTable.bucketKey, input.bucketKey),
          eq(publicApiRateLimitWindowsTable.windowStart, input.windowStart),
        ),
      )
      .get()) ?? null;

  if (row === null) {
    throw new Error("Public API rate-limit event count could not be read.");
  }

  return {
    requestCount: Number(row.requestCount ?? 0),
    windowStart: input.windowStart,
  };
}

export async function enforcePublishedApiRateLimit(
  database: D1Database,
  tokenId: string,
  nowMs = currentTimestampMs(),
): Promise<void> {
  const bucketKey = getBucketKey(tokenId);
  const windowStart = getWindowStart(nowMs);
  const window = await incrementRateLimitWindow({
    bucketKey,
    database,
    nowMs,
    windowStart,
  });

  if (window.requestCount <= PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE) {
    return;
  }

  throw publicRateLimited(getRetryAfterSeconds(window.windowStart, nowMs));
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
