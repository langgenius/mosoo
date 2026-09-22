import type { PublicApiVersion } from "@mosoo/contracts/public-api";
import type { PublicThreadApiRetrieveThreadResponse } from "@mosoo/contracts/public-api";

import { admitPublicThreadReader } from "./public-thread-admission";
import { readPublicThreadRunFinalOutput } from "./public-thread-events";
import { toBackingSessionId } from "./public-thread-ids";
import { toRetrieveThreadResponse } from "./public-thread-presenter";
import { getThreadSnapshot } from "./public-thread-store";
import type { RetrievePublicThreadRequest } from "./public-thread.types";

export async function retrievePublicThread(
  request: RetrievePublicThreadRequest,
): Promise<PublicThreadApiRetrieveThreadResponse<string | null, PublicApiVersion>> {
  const snapshot = await getThreadSnapshot(request.database, request.threadId, request.apiVersion);

  await admitPublicThreadReader(request.database, request.caller, snapshot, request.apiVersion);

  const finalOutput =
    snapshot.session.lastRun?.status === "completed"
      ? await readPublicThreadRunFinalOutput({
          database: request.database,
          runId: snapshot.session.lastRun.id,
          sessionId: toBackingSessionId(request.threadId),
        })
      : null;

  return toRetrieveThreadResponse({
    apiVersion: request.apiVersion,
    endUserId: snapshot.endUserId,
    legacyKind: snapshot.row.kind,
    finalOutput,
    session: snapshot.session,
  });
}
