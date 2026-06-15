import type { PublicThreadApiRetrieveThreadResponse } from "@mosoo/contracts/public-api";

import { admitPublicThreadReader } from "./public-thread-admission";
import { toRetrieveThreadResponse } from "./public-thread-presenter";
import { getThreadSnapshot } from "./public-thread-store";
import type { RetrievePublicThreadRequest } from "./public-thread.types";

export async function retrievePublicThread(
  request: RetrievePublicThreadRequest,
): Promise<PublicThreadApiRetrieveThreadResponse> {
  const snapshot = await getThreadSnapshot(request.database, request.threadId);

  await admitPublicThreadReader(request.database, request.caller, snapshot);

  return toRetrieveThreadResponse({
    attributedUserId: snapshot.row.attributed_user_id,
    metadata: snapshot.metadata,
    session: snapshot.session,
  });
}
