import type { PublicThreadApiRetrieveThreadResponse } from "@mosoo/contracts/public-api";

import { admitPublicThreadReader } from "./public-thread-admission";
import {
  readPublicThreadRunArtifacts,
  readPublicThreadRunFinalOutput,
} from "./public-thread-events";
import { toBackingSessionId } from "./public-thread-ids";
import { toRetrieveThreadResponse } from "./public-thread-presenter";
import { getThreadSnapshot } from "./public-thread-store";
import type { RetrievePublicThreadRequest } from "./public-thread.types";

export async function retrievePublicThread(
  request: RetrievePublicThreadRequest,
): Promise<PublicThreadApiRetrieveThreadResponse> {
  const snapshot = await getThreadSnapshot(request.database, request.threadId);

  await admitPublicThreadReader(request.database, request.caller, snapshot);

  const lastRun = snapshot.session.lastRun;
  const [artifacts, finalOutput] =
    lastRun === null
      ? [[], null]
      : await Promise.all([
          readPublicThreadRunArtifacts({
            database: request.database,
            runId: lastRun.id,
          }),
          lastRun.status === "completed"
            ? readPublicThreadRunFinalOutput({
                database: request.database,
                runId: lastRun.id,
                sessionId: toBackingSessionId(request.threadId),
              })
            : null,
        ]);

  return toRetrieveThreadResponse({
    artifacts,
    endUserId: snapshot.endUserId,
    finalOutput,
    session: snapshot.session,
  });
}
