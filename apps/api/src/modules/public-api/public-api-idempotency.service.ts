import { publicApiIdempotencyKeysTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { PlatformId } from "@mosoo/id";
import { and, eq, isNull, lt } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import { currentTimestampMs } from "../../time";
import { publicIdempotencyConflict, publicInvalidRequest } from "./public-api-errors";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const IDEMPOTENCY_RETRY_AFTER_SECONDS = 2;
const PUBLIC_API_IDEMPOTENCY_PROCESSING_TTL_MS = 10 * 60 * 1000;
const PUBLIC_API_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

interface PublicApiIdempotencyRow {
  body_hash: string | null;
  id: PlatformId;
  idempotency_key: string;
  method: string;
  response_json: string | null;
  response_status: number | null;
  route: string;
  token_id: PlatformId;
  updated_at: number;
}

export interface PublicApiIdempotencyInput {
  bodyHash: string | null;
  idempotencyKey: string;
  method: string;
  route: string;
  tokenId: PlatformId;
}

export type PublicApiIdempotencyBeginResult =
  | {
      reservationId: PlatformId;
      status: "reserved";
    }
  | {
      body: unknown;
      responseStatus: number;
      status: "replay";
    }
  | {
      reservationId: PlatformId;
      retryAfterSeconds: number;
      status: "processing";
      stale: boolean;
    };

export function readPublicApiIdempotencyKey(request: Request): string | null {
  const value = request.headers.get("Idempotency-Key");

  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw publicInvalidRequest("Idempotency-Key cannot be empty.");
  }

  if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw publicInvalidRequest(
      `Idempotency-Key must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer.`,
    );
  }

  return normalized;
}

export async function hashPublicApiIdempotencyBody(value: unknown): Promise<string | null> {
  if (value === undefined || value === null) {
    return null;
  }

  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function enforceSameIdempotentRequest(
  row: PublicApiIdempotencyRow,
  input: PublicApiIdempotencyInput,
) {
  const sameRequest =
    row.method === input.method && row.route === input.route && row.body_hash === input.bodyHash;

  if (!sameRequest) {
    throw publicIdempotencyConflict(
      "Idempotency-Key was already used for a different request.",
      IDEMPOTENCY_RETRY_AFTER_SECONDS,
    );
  }
}

function parseStoredReplayBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Stored public API idempotency response JSON is invalid.", { cause: error });
  }
}

function isCompletedIdempotencyRow(row: PublicApiIdempotencyRow): boolean {
  return row.response_status !== null && row.response_json !== null;
}

function toProcessingResult(
  row: PublicApiIdempotencyRow,
  nowMs: number,
): PublicApiIdempotencyBeginResult {
  const stale = row.updated_at < nowMs - PUBLIC_API_IDEMPOTENCY_PROCESSING_TTL_MS;

  return {
    reservationId: row.id,
    retryAfterSeconds: stale
      ? Math.max(
          1,
          Math.ceil((row.updated_at + PUBLIC_API_IDEMPOTENCY_RETENTION_MS - nowMs) / 1_000),
        )
      : IDEMPOTENCY_RETRY_AFTER_SECONDS,
    stale,
    status: "processing",
  };
}

function toReplayResult(row: PublicApiIdempotencyRow): PublicApiIdempotencyBeginResult {
  if (row.response_status === null || row.response_json === null) {
    throw new Error("Cannot replay an incomplete public API idempotency record.");
  }

  return {
    body: parseStoredReplayBody(row.response_json),
    responseStatus: row.response_status,
    status: "replay",
  };
}

async function getIdempotencyRow(
  database: D1Database,
  tokenId: PlatformId,
  idempotencyKey: string,
): Promise<PublicApiIdempotencyRow | null> {
  return (
    (await getAppDatabase(database)
      .select({
        body_hash: publicApiIdempotencyKeysTable.bodyHash,
        id: publicApiIdempotencyKeysTable.id,
        idempotency_key: publicApiIdempotencyKeysTable.idempotencyKey,
        method: publicApiIdempotencyKeysTable.method,
        response_json: publicApiIdempotencyKeysTable.responseJson,
        response_status: publicApiIdempotencyKeysTable.responseStatus,
        route: publicApiIdempotencyKeysTable.route,
        token_id: publicApiIdempotencyKeysTable.tokenId,
        updated_at: publicApiIdempotencyKeysTable.updatedAt,
      })
      .from(publicApiIdempotencyKeysTable)
      .where(
        and(
          eq(publicApiIdempotencyKeysTable.tokenId, tokenId),
          eq(publicApiIdempotencyKeysTable.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function beginPublicApiIdempotency(
  database: D1Database,
  input: PublicApiIdempotencyInput,
  nowMs = currentTimestampMs(),
): Promise<PublicApiIdempotencyBeginResult> {
  const existing = await getIdempotencyRow(database, input.tokenId, input.idempotencyKey);

  if (existing) {
    enforceSameIdempotentRequest(existing, input);

    if (existing.updated_at < nowMs - PUBLIC_API_IDEMPOTENCY_RETENTION_MS) {
      await getAppDatabase(database)
        .delete(publicApiIdempotencyKeysTable)
        .where(eq(publicApiIdempotencyKeysTable.id, existing.id))
        .run();
    } else if (!isCompletedIdempotencyRow(existing)) {
      return toProcessingResult(existing, nowMs);
    } else {
      return toReplayResult(existing);
    }
  }

  await cleanupPublicApiIdempotencyKeys(database, nowMs);

  const reservationId = createPlatformId();

  await getAppDatabase(database)
    .insert(publicApiIdempotencyKeysTable)
    .values({
      bodyHash: input.bodyHash,
      createdAt: nowMs,
      id: reservationId,
      idempotencyKey: input.idempotencyKey,
      method: input.method,
      responseJson: null,
      responseStatus: null,
      route: input.route,
      tokenId: input.tokenId,
      updatedAt: nowMs,
    })
    .onConflictDoNothing()
    .run();

  const current = await getIdempotencyRow(database, input.tokenId, input.idempotencyKey);

  if (!current) {
    throw publicIdempotencyConflict(
      "Idempotency-Key reservation could not be confirmed.",
      IDEMPOTENCY_RETRY_AFTER_SECONDS,
    );
  }

  if (current.id !== reservationId) {
    enforceSameIdempotentRequest(current, input);

    if (!isCompletedIdempotencyRow(current)) {
      return toProcessingResult(current, nowMs);
    }

    return toReplayResult(current);
  }

  return {
    reservationId,
    status: "reserved",
  };
}

export async function completePublicApiIdempotency(
  database: D1Database,
  reservationId: PlatformId,
  response: {
    body: unknown;
    status: number;
  },
): Promise<void> {
  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .update(publicApiIdempotencyKeysTable)
    .set({
      responseJson: JSON.stringify(response.body),
      responseStatus: response.status,
      updatedAt: timestampMs,
    })
    .where(eq(publicApiIdempotencyKeysTable.id, reservationId))
    .run();
}

export async function clearPublicApiIdempotencyReservation(
  database: D1Database,
  reservationId: PlatformId,
): Promise<void> {
  await getAppDatabase(database)
    .delete(publicApiIdempotencyKeysTable)
    .where(
      and(
        eq(publicApiIdempotencyKeysTable.id, reservationId),
        isNull(publicApiIdempotencyKeysTable.responseStatus),
      ),
    )
    .run();
}

async function cleanupPublicApiIdempotencyKeys(
  database: D1Database,
  nowMs = currentTimestampMs(),
): Promise<void> {
  await getAppDatabase(database)
    .delete(publicApiIdempotencyKeysTable)
    .where(lt(publicApiIdempotencyKeysTable.updatedAt, nowMs - PUBLIC_API_IDEMPOTENCY_RETENTION_MS))
    .run();
}
