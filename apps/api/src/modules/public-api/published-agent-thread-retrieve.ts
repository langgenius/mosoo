import type { PublishedAgentRetrieveThreadResponse } from "@mosoo/contracts/public-api";

import { admitPublishedThreadReader } from "./published-agent-thread-admission";
import { toRetrieveThreadResponse } from "./published-agent-thread-presenter";
import { getThreadSnapshot } from "./published-agent-thread-store";
import type { RetrievePublishedAgentThreadRequest } from "./published-agent-thread.types";

export async function retrievePublishedAgentThread(
  request: RetrievePublishedAgentThreadRequest,
): Promise<PublishedAgentRetrieveThreadResponse> {
  const snapshot = await getThreadSnapshot(request.database, request.threadId);

  await admitPublishedThreadReader(request.database, request.caller, snapshot);

  return toRetrieveThreadResponse({
    attributedUserId: snapshot.row.attributed_user_id,
    metadata: snapshot.metadata,
    session: snapshot.session,
  });
}
