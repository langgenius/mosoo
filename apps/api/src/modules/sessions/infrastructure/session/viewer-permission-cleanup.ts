import type { SessionId } from "@mosoo/id";

import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../../time";
import { rejectSessionPermissionRequests } from "../../../runtime/application/session-run.service";
import { appendSessionRuntimeEvents } from "../../application/session-event-write.service";
import { requireActiveProjectSession } from "../../domain/session-access.policy";
import type { SessionViewerSocketContext } from "./socket-headers";

const VIEWER_PERMISSION_CLEANUP_STORAGE_KEY = "viewer_permission_cleanup";
export const VIEWER_PERMISSION_CLEANUP_DELAY_MS = 120_000;

export async function clearViewerPermissionCleanupAlarm(
  storage: DurableObjectStorage,
): Promise<void> {
  await storage.delete(VIEWER_PERMISSION_CLEANUP_STORAGE_KEY);
  await storage.deleteAlarm();
}

export async function scheduleViewerPermissionCleanupAlarm(input: {
  attachment: SessionViewerSocketContext;
  storage: DurableObjectStorage;
}): Promise<void> {
  await input.storage.put(VIEWER_PERMISSION_CLEANUP_STORAGE_KEY, input.attachment);
  await input.storage.setAlarm(currentTimestampMs() + VIEWER_PERMISSION_CLEANUP_DELAY_MS);
}

export async function runViewerPermissionCleanupAlarm(input: {
  env: ApiBindings;
  hasOpenViewer: (sessionId: SessionId) => boolean;
  storage: DurableObjectStorage;
}): Promise<void> {
  const pending = await input.storage.get<SessionViewerSocketContext>(
    VIEWER_PERMISSION_CLEANUP_STORAGE_KEY,
  );

  if (pending === undefined || input.hasOpenViewer(pending.sessionId)) {
    await clearViewerPermissionCleanupAlarm(input.storage);
    return;
  }

  try {
    await requireActiveProjectSession(input.env.DB, pending.viewer.id, {
      projectId: pending.projectId,
      sessionId: pending.sessionId,
    });
  } catch (error) {
    logWarn("session.viewer_socket.permission_cleanup.skipped", {
      ...createErrorLogContext(error),
      sessionId: pending.sessionId,
      viewerId: pending.viewer.id,
    });
    await clearViewerPermissionCleanupAlarm(input.storage);
    return;
  }

  const rejected = await rejectSessionPermissionRequests({
    bindings: input.env,
    onPermissionCleanupError: (error, requestId) => {
      logWarn("session.viewer_socket.permission_cleanup.failed", {
        ...createErrorLogContext(error),
        requestId,
        sessionId: pending.sessionId,
        viewerId: pending.viewer.id,
      });
    },
    projectId: pending.projectId,
    sessionId: pending.sessionId,
    viewer: pending.viewer,
  });

  if (rejected !== null) {
    // The alarm runs inside this Session DO and no viewer is connected, so persist only.
    await appendSessionRuntimeEvents({
      bindings: input.env,
      deliver: false,
      events: [rejected],
      sessionId: pending.sessionId,
    });
  }

  await clearViewerPermissionCleanupAlarm(input.storage);
}
