import type { SessionViewFile } from "@mosoo/ag-ui-session";
import type { FileRecord } from "@mosoo/contracts/file";
import { parsePlatformId } from "@mosoo/id";
import type { FileId, SessionId } from "@mosoo/id";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
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
    kind: "attachment",
    mimeType: file.mimeType,
    name: file.name,
    size: file.size,
  };
}

async function bestEffortMaterializeSessionResources(
  bindings: ApiBindings,
  sessionId: SessionId,
): Promise<void> {
  try {
    const { ensureActiveSessionResourcesMaterialized } =
      await import("../../runtime/application/session-resources/session-resource-materialization.service");
    await ensureActiveSessionResourcesMaterialized(bindings, sessionId);
  } catch (error) {
    logWarn("session.resource.materialization.failed", {
      ...createErrorLogContext(error),
      sessionId,
    });
  }
}

export async function publishSessionResourceUpsert(
  bindings: ApiBindings,
  file: FileRecord,
): Promise<void> {
  if (file.scope.kind !== "session") {
    return;
  }

  const sessionId = parsePlatformId<SessionId>(file.scope.id, "Session resource scope ID");
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

  await bestEffortMaterializeSessionResources(bindings, sessionId);
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

  await bestEffortMaterializeSessionResources(input.bindings, input.sessionId);
  await appendSessionRuntimeEvents({
    bindings: input.bindings,
    events: [event],
    sessionId: input.sessionId,
  });
}
