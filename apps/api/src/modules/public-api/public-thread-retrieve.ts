import type { PublicApiVersion } from "@mosoo/contracts/public-api";
import type { PublicThreadApiRetrieveThreadResponse } from "@mosoo/contracts/public-api";

import { readPublicThreadRunFinalOutput } from "./public-thread-events";
import { toRetrieveThreadResponse } from "./public-thread-presenter";
import { admitPublicThread } from "./public-thread-session-query.service";
import type { RetrievePublicThreadRequest } from "./public-thread.types";

export async function retrievePublicThread(
  request: RetrievePublicThreadRequest,
): Promise<PublicThreadApiRetrieveThreadResponse<string | null, PublicApiVersion>> {
  const thread = await admitPublicThread(
    request.database,
    request.caller,
    request.threadId,
    request.apiVersion,
  );

  const finalOutput =
    thread.session.lastRun?.status === "completed"
      ? await readPublicThreadRunFinalOutput({
          database: request.database,
          runId: thread.session.lastRun.id,
          sessionId: request.threadId,
        })
      : null;

  return toRetrieveThreadResponse({
    apiVersion: request.apiVersion,
    endUserId: thread.endUserId,
    legacyKind: thread.kind,
    finalOutput,
    session: thread.session,
  });
}
