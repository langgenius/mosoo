import type { SessionViewFile } from "@mosoo/ag-ui-session";
import type { FileRecord } from "@mosoo/contracts/file";
import type { FileId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  appendSessionRuntimeEvents,
  createSessionRuntimeEvent,
} from "./session-event-write.service";

function toSessionResourceViewFile(file: FileRecord): SessionViewFile {
  return {
    committed: true,
    createdAt: file.createdAt,
    id: file.id,
    kind: file.sessionKind ?? "attachment",
    mimeType: file.mimeType,
    name: file.name,
    size: file.size,
  };
}

export async function publishSessionResourceUpsert(
  bindings: ApiBindings,
  file: FileRecord,
): Promise<void> {
  if (file.scope.kind !== "session") {
    return;
  }

  const sessionId = file.scope.id as SessionId;
  const event = createSessionRuntimeEvent({
    kind: "session.files.updated",
    origin: "file",
    payload: {
      change: {
        change: "upsert",
        file: toSessionResourceViewFile(file),
      },
    },
    sessionId,
  });

  await appendSessionRuntimeEvents({
    bindings,
    events: [event],
    sessionId,
  });
}

export async function publishSessionResourceDelete(input: {
  bindings: ApiBindings;
  resourceId: FileId;
  sessionId: SessionId;
}): Promise<void> {
  const event = createSessionRuntimeEvent({
    kind: "session.files.updated",
    origin: "file",
    payload: {
      change: {
        change: "delete",
        fileId: input.resourceId,
      },
    },
    sessionId: input.sessionId,
  });

  await appendSessionRuntimeEvents({
    bindings: input.bindings,
    events: [event],
    sessionId: input.sessionId,
  });
}
