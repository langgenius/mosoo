import type { SessionLiveState } from "@mosoo/ag-ui-session";
import type { AccountId, AppId, SessionId } from "@mosoo/id";

import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../../time";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { getActiveAppSessionParticipantAccess } from "../../domain/session-access.policy";
import type { PermissionStateUpdateResult } from "./viewer-permissions";
import { rejectDisconnectedViewerPermissionRequests } from "./viewer-permissions";
import type { ViewerSocketAttachment } from "./viewer-socket";

const VIEWER_PERMISSION_CLEANUP_STORAGE_KEY = "viewer_permission_cleanup";
export const VIEWER_PERMISSION_CLEANUP_DELAY_MS = 120_000;

export interface ViewerPermissionCleanupStorage {
  delete(key: string): Promise<boolean>;
  deleteAlarm(): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(scheduledTime: Date | number): Promise<void>;
}

interface PendingViewerPermissionCleanup {
  publicOrigin: string;
  appId: AppId;
  scheduledAtMs: number;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

type RejectDisconnectedViewerPermissions = (
  input: Parameters<typeof rejectDisconnectedViewerPermissionRequests>[0],
) => Promise<PermissionStateUpdateResult | null>;

type EnsureSessionActive = (
  database: D1Database,
  viewerId: AccountId,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
) => Promise<void>;

async function ensureActiveAppSessionParticipantAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    appId: AppId;
    sessionId: SessionId;
  },
): Promise<void> {
  await getActiveAppSessionParticipantAccess(database, viewerId, input);
}

export async function clearViewerPermissionCleanupAlarm(input: {
  storage: ViewerPermissionCleanupStorage;
}): Promise<void> {
  await input.storage.delete(VIEWER_PERMISSION_CLEANUP_STORAGE_KEY);
  await input.storage.deleteAlarm();
}

export async function scheduleViewerPermissionCleanupAlarm(input: {
  attachment: ViewerSocketAttachment;
  nowMs?: () => number;
  storage: ViewerPermissionCleanupStorage;
}): Promise<void> {
  const nowMs = input.nowMs?.() ?? currentTimestampMs();
  const pending: PendingViewerPermissionCleanup = {
    publicOrigin: input.attachment.publicOrigin,
    appId: input.attachment.appId,
    scheduledAtMs: nowMs,
    sessionId: input.attachment.sessionId,
    viewer: input.attachment.viewer,
  };

  await input.storage.put(VIEWER_PERMISSION_CLEANUP_STORAGE_KEY, pending);
  await input.storage.setAlarm(nowMs + VIEWER_PERMISSION_CLEANUP_DELAY_MS);
}

function toViewerSocketAttachment(pending: PendingViewerPermissionCleanup): ViewerSocketAttachment {
  return {
    publicOrigin: pending.publicOrigin,
    appId: pending.appId,
    role: "viewer",
    sessionId: pending.sessionId,
    viewer: pending.viewer,
  };
}

export async function runViewerPermissionCleanupAlarm(input: {
  cachedState: SessionLiveState | null;
  ensureSessionActive?: EnsureSessionActive;
  env: ApiBindings;
  hasOpenViewer: (sessionId: SessionId) => boolean;
  rejectPermissions?: RejectDisconnectedViewerPermissions;
  storage: ViewerPermissionCleanupStorage;
  updateLiveStateCache: (state: SessionLiveState | null) => void;
}): Promise<void> {
  const pending =
    (await input.storage.get<PendingViewerPermissionCleanup>(
      VIEWER_PERMISSION_CLEANUP_STORAGE_KEY,
    )) ?? null;

  if (pending === null) {
    await input.storage.deleteAlarm();
    return;
  }

  if (input.hasOpenViewer(pending.sessionId)) {
    await clearViewerPermissionCleanupAlarm({ storage: input.storage });
    return;
  }

  const ensureSessionActive = input.ensureSessionActive ?? ensureActiveAppSessionParticipantAccess;

  try {
    await ensureSessionActive(input.env.DB, pending.viewer.id, {
      appId: pending.appId,
      sessionId: pending.sessionId,
    });
  } catch (error) {
    logWarn("session.viewer_socket.permission_cleanup.skipped", {
      ...createErrorLogContext(error),
      sessionId: pending.sessionId,
      viewerId: pending.viewer.id,
    });
    await clearViewerPermissionCleanupAlarm({ storage: input.storage });
    return;
  }

  const rejectPermissions = input.rejectPermissions ?? rejectDisconnectedViewerPermissionRequests;
  const result = await rejectPermissions({
    attachment: toViewerSocketAttachment(pending),
    cachedState: input.cachedState,
    env: input.env,
    onPermissionCleanupError: (error, requestId) => {
      logWarn("session.viewer_socket.permission_cleanup.failed", {
        ...createErrorLogContext(error),
        requestId,
        sessionId: pending.sessionId,
        viewerId: pending.viewer.id,
      });
    },
  });

  if (result !== null) {
    input.updateLiveStateCache(result.state);
  }

  await clearViewerPermissionCleanupAlarm({ storage: input.storage });
}
