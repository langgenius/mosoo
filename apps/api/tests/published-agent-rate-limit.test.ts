import { describe, expect, test } from "bun:test";

import type { PublishedAgentApiError } from "../src/modules/public-api/published-agent-api-errors";
import {
  PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE,
  PUBLIC_API_RATE_LIMIT_RETENTION_MS,
  PUBLIC_API_RATE_LIMIT_WINDOW_MS,
  cleanupPublicApiRateLimitWindows,
  enforcePublishedApiRateLimit,
} from "../src/modules/public-api/published-agent-rate-limit.service";
import { createPublicHttpContractDatabase } from "./helpers/published-agent-http-test-fixture";

async function countRateLimitRequests(
  database: D1Database,
  bucketKey: string,
  windowStart: number,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT COALESCE(SUM(request_count), 0) AS request_count
       FROM public_api_rate_limit_window
       WHERE bucket_key = ? AND window_start = ?`,
    )
    .bind(bucketKey, windowStart)
    .first<{ request_count: number }>();

  return row?.request_count ?? 0;
}

describe("Published Agent API rate limiting", () => {
  test("records sharded hot-path windows and rejects requests over the window limit", async () => {
    const database = await createPublicHttpContractDatabase();
    const nowMs = 120_000;

    for (let index = 0; index < PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE; index += 1) {
      await enforcePublishedApiRateLimit(database, "token-1", nowMs);
    }

    await expect(enforcePublishedApiRateLimit(database, "token-1", nowMs)).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 60,
      status: 429,
    } satisfies Partial<PublishedAgentApiError>);

    await expect(countRateLimitRequests(database, "public_api:token-1", nowMs)).resolves.toBe(
      PUBLIC_API_RATE_LIMIT_REQUESTS_PER_MINUTE + 1,
    );
  });

  test("counts requests independently for each rate-limit window", async () => {
    const database = await createPublicHttpContractDatabase();
    const firstWindowMs = 180_000;
    const secondWindowMs = firstWindowMs + PUBLIC_API_RATE_LIMIT_WINDOW_MS;

    await enforcePublishedApiRateLimit(database, "token-1", firstWindowMs);
    await enforcePublishedApiRateLimit(database, "token-1", secondWindowMs);

    await expect(
      countRateLimitRequests(database, "public_api:token-1", firstWindowMs),
    ).resolves.toBe(1);
    await expect(
      countRateLimitRequests(database, "public_api:token-1", secondWindowMs),
    ).resolves.toBe(1);
  });

  test("keeps stale window cleanup explicit and off the request hot path", async () => {
    const database = await createPublicHttpContractDatabase();
    const staleUpdatedAt = 1_000;
    const cleanupNowMs = staleUpdatedAt + PUBLIC_API_RATE_LIMIT_RETENTION_MS + 1;

    await database
      .prepare(
        `INSERT INTO public_api_rate_limit_window (
          bucket_key,
          window_start,
          shard,
          request_count,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind("public_api:stale-token", staleUpdatedAt, 0, 1, staleUpdatedAt)
      .run();

    await enforcePublishedApiRateLimit(database, "fresh-token", cleanupNowMs);
    await expect(
      countRateLimitRequests(database, "public_api:stale-token", staleUpdatedAt),
    ).resolves.toBe(1);

    await cleanupPublicApiRateLimitWindows(database, cleanupNowMs);
    await expect(
      countRateLimitRequests(database, "public_api:stale-token", staleUpdatedAt),
    ).resolves.toBe(0);
  });
});
