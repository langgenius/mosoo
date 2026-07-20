import { boundAgentCallIdempotencyKeysTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { PlatformId, SessionId, SessionRunId } from "@mosoo/id";
import { and, eq, isNull, or } from "drizzle-orm";

import { getAppDatabase } from "../../platform/db/drizzle";
import { currentTimestampMs } from "../../time";
import type { AppAgentCapabilityClaims } from "./app-agent-capability";
import { publicIdempotencyConflict } from "./public-api-errors";
import { hashPublicApiIdempotencyBody } from "./public-api-idempotency.service";

const IDEMPOTENCY_RETRY_AFTER_SECONDS = 2;

interface BoundAgentCallIdempotencyRow {
  bodyHash: string;
  id: PlatformId;
  runId: SessionRunId | null;
  sessionId: SessionId;
}

export interface BoundAgentCallIdempotencyInput {
  bodyHash: string;
  idempotencyKey: string;
  subjectHash: string;
}

export interface BoundAgentCallIdempotencyReservation {
  reservationId: PlatformId;
  runId: SessionRunId | null;
  sessionId: SessionId;
  status: "existing" | "reserved";
}

export async function hashBoundAgentCallIdempotencyBody(message: string): Promise<string> {
  const bodyHash = await hashPublicApiIdempotencyBody({ message });

  if (bodyHash === null) {
    throw new Error("Bound Agent idempotency body cannot be empty.");
  }

  return bodyHash;
}

export async function hashBoundAgentCallIdempotencySubject(
  claims: AppAgentCapabilityClaims,
): Promise<string> {
  const subjectHash = await hashPublicApiIdempotencyBody({
    agentId: claims.agentId,
    appId: claims.appId,
    binding: {
      env: claims.binding.env,
      expose: claims.binding.expose,
      name: claims.binding.name,
    },
    deploymentId: claims.deploymentId,
    deploymentRunId: claims.deploymentRunId,
  });

  if (subjectHash === null) {
    throw new Error("Bound Agent idempotency subject cannot be empty.");
  }

  return subjectHash;
}

async function readReservation(
  database: D1Database,
  input: Pick<BoundAgentCallIdempotencyInput, "idempotencyKey" | "subjectHash">,
): Promise<BoundAgentCallIdempotencyRow | null> {
  return (
    (await getAppDatabase(database)
      .select({
        bodyHash: boundAgentCallIdempotencyKeysTable.bodyHash,
        id: boundAgentCallIdempotencyKeysTable.id,
        runId: boundAgentCallIdempotencyKeysTable.runId,
        sessionId: boundAgentCallIdempotencyKeysTable.sessionId,
      })
      .from(boundAgentCallIdempotencyKeysTable)
      .where(
        and(
          eq(boundAgentCallIdempotencyKeysTable.subjectHash, input.subjectHash),
          eq(boundAgentCallIdempotencyKeysTable.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function beginBoundAgentCallIdempotency(
  database: D1Database,
  input: BoundAgentCallIdempotencyInput,
): Promise<BoundAgentCallIdempotencyReservation> {
  const reservationId = createPlatformId();
  const sessionId = createPlatformId<SessionId>();
  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .insert(boundAgentCallIdempotencyKeysTable)
    .values({
      bodyHash: input.bodyHash,
      createdAt: timestampMs,
      id: reservationId,
      idempotencyKey: input.idempotencyKey,
      sessionId,
      subjectHash: input.subjectHash,
      updatedAt: timestampMs,
    })
    .onConflictDoNothing()
    .run();

  const current = await readReservation(database, input);

  if (current === null) {
    throw publicIdempotencyConflict(
      "Idempotency-Key reservation could not be confirmed.",
      IDEMPOTENCY_RETRY_AFTER_SECONDS,
    );
  }

  if (current.bodyHash !== input.bodyHash) {
    throw publicIdempotencyConflict(
      "Idempotency-Key was already used for a different request.",
      IDEMPOTENCY_RETRY_AFTER_SECONDS,
    );
  }

  return {
    reservationId: current.id,
    runId: current.runId,
    sessionId: current.sessionId,
    status: current.id === reservationId ? "reserved" : "existing",
  };
}

export async function bindBoundAgentCallIdempotencyRun(
  database: D1Database,
  input: {
    reservationId: PlatformId;
    runId: SessionRunId;
    sessionId: SessionId;
  },
): Promise<void> {
  await getAppDatabase(database)
    .update(boundAgentCallIdempotencyKeysTable)
    .set({
      runId: input.runId,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(boundAgentCallIdempotencyKeysTable.id, input.reservationId),
        eq(boundAgentCallIdempotencyKeysTable.sessionId, input.sessionId),
        or(
          isNull(boundAgentCallIdempotencyKeysTable.runId),
          eq(boundAgentCallIdempotencyKeysTable.runId, input.runId),
        ),
      ),
    )
    .run();

  const current = await getAppDatabase(database)
    .select({ runId: boundAgentCallIdempotencyKeysTable.runId })
    .from(boundAgentCallIdempotencyKeysTable)
    .where(eq(boundAgentCallIdempotencyKeysTable.id, input.reservationId))
    .limit(1)
    .get();

  if (current?.runId !== input.runId) {
    throw new Error("Bound Agent idempotency Run binding could not be confirmed.");
  }
}
