import { describe, expect, test } from "bun:test";

import type { ProjectId, SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { readSessionViewerSocketHeaders } from "../src/modules/sessions/infrastructure/session/socket-headers";
import {
  runViewerPermissionCleanupAlarm,
  scheduleViewerPermissionCleanupAlarm,
  VIEWER_PERMISSION_CLEANUP_DELAY_MS,
} from "../src/modules/sessions/infrastructure/session/viewer-permission-cleanup";
import type { ViewerPermissionCleanupStorage } from "../src/modules/sessions/infrastructure/session/viewer-permission-cleanup";
import { normalizeViewerSocketAttachment } from "../src/modules/sessions/infrastructure/session/viewer-socket";
import type { ViewerSocketAttachment } from "../src/modules/sessions/infrastructure/session/viewer-socket";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

class MemoryViewerPermissionCleanupStorage implements ViewerPermissionCleanupStorage {
  alarmAt: Date | number | null = null;
  readonly values = new Map<string, unknown>();

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async setAlarm(scheduledTime: Date | number): Promise<void> {
    this.alarmAt = scheduledTime;
  }
}

const VIEWER: AuthenticatedViewer = {
  email: "viewer@example.com",
  emailVerified: true,
  id: "viewer-1",
  imageUrl: null,
  name: "Viewer",
};
const PROJECT_ID = "01J0000000000000000000000Q" as ProjectId;

function createAttachment(sessionId: SessionId = "session-1" as SessionId): ViewerSocketAttachment {
  return {
    projectId: PROJECT_ID,
    publicOrigin: "https://mosoo.ai",
    role: "viewer",
    sessionId,
    viewer: VIEWER,
  };
}

function createBindings(): ApiBindings {
  return {
    DB: {} as D1Database,
  } as ApiBindings;
}

describe("viewer permission cleanup alarm", () => {
  test("reads pre-Project internal websocket headers during a rolling release", () => {
    const headers = new Headers({
      "x-viewer-email": encodeURIComponent(VIEWER.email),
      "x-viewer-email-verified": "true",
      "x-viewer-id": "01J0000000000000000000000A",
      "x-viewer-image-url": "",
      "x-viewer-name": encodeURIComponent(VIEWER.name),
      "x-viewer-origin": "https://mosoo.ai",
      "x-viewer-app-id": PROJECT_ID,
      "x-viewer-session-id": "01J0000000000000000000000S",
    });

    expect(readSessionViewerSocketHeaders(headers).projectId).toBe(PROJECT_ID);
  });

  test("normalizes hibernating pre-Project socket attachments", () => {
    const { projectId: _, ...legacyAttachment } = createAttachment();

    expect(normalizeViewerSocketAttachment({ ...legacyAttachment, appId: PROJECT_ID })).toEqual({
      ...legacyAttachment,
      appId: PROJECT_ID,
      projectId: PROJECT_ID,
    });
  });

  test("schedules cleanup 120 seconds after the last viewer disconnects", async () => {
    const storage = new MemoryViewerPermissionCleanupStorage();

    await scheduleViewerPermissionCleanupAlarm({
      attachment: createAttachment(),
      nowMs: () => 1_000,
      storage,
    });

    expect(storage.alarmAt).toBe(1_000 + VIEWER_PERMISSION_CLEANUP_DELAY_MS);
  });

  test("does not reject permissions when a viewer is open at alarm time", async () => {
    const storage = new MemoryViewerPermissionCleanupStorage();
    let rejected = false;

    await scheduleViewerPermissionCleanupAlarm({
      attachment: createAttachment(),
      nowMs: () => 1_000,
      storage,
    });
    await runViewerPermissionCleanupAlarm({
      cachedState: null,
      ensureSessionActive: async () => {},
      env: createBindings(),
      hasOpenViewer: () => true,
      rejectPermissions: async () => {
        rejected = true;
        return null;
      },
      storage,
      updateLiveStateCache: () => {},
    });

    expect(rejected).toBe(false);
    expect(storage.alarmAt).toBeNull();
  });

  test("rejects permissions when no viewer reconnects before the alarm", async () => {
    const storage = new MemoryViewerPermissionCleanupStorage();
    let ensured = false;
    let rejected = false;

    await scheduleViewerPermissionCleanupAlarm({
      attachment: createAttachment(),
      nowMs: () => 1_000,
      storage,
    });
    await runViewerPermissionCleanupAlarm({
      cachedState: null,
      ensureSessionActive: async () => {
        ensured = true;
      },
      env: createBindings(),
      hasOpenViewer: () => false,
      rejectPermissions: async () => {
        rejected = true;
        return null;
      },
      storage,
      updateLiveStateCache: () => {},
    });

    expect(ensured).toBe(true);
    expect(rejected).toBe(true);
    expect(storage.alarmAt).toBeNull();
  });

  test("runs a pending pre-Project cleanup record after a release", async () => {
    const storage = new MemoryViewerPermissionCleanupStorage();
    let ensuredProjectId: ProjectId | null = null;
    let rejectedProjectId: ProjectId | null = null;
    storage.values.set("viewer_permission_cleanup", {
      appId: PROJECT_ID,
      publicOrigin: "https://mosoo.ai",
      scheduledAtMs: 1_000,
      sessionId: "session-1",
      viewer: VIEWER,
    });

    await runViewerPermissionCleanupAlarm({
      cachedState: null,
      ensureSessionActive: async (_database, _viewerId, input) => {
        ensuredProjectId = input.projectId;
      },
      env: createBindings(),
      hasOpenViewer: () => false,
      rejectPermissions: async (input) => {
        rejectedProjectId = input.attachment.projectId;
        return null;
      },
      storage,
      updateLiveStateCache: () => {},
    });

    expect(ensuredProjectId).toBe(PROJECT_ID);
    expect(rejectedProjectId).toBe(PROJECT_ID);
    expect(storage.alarmAt).toBeNull();
  });

  test("skips rejection when the session is no longer active", async () => {
    const storage = new MemoryViewerPermissionCleanupStorage();
    let rejected = false;

    await scheduleViewerPermissionCleanupAlarm({
      attachment: createAttachment(),
      nowMs: () => 1_000,
      storage,
    });
    await runViewerPermissionCleanupAlarm({
      cachedState: null,
      ensureSessionActive: async () => {
        throw new Error("inactive");
      },
      env: createBindings(),
      hasOpenViewer: () => false,
      rejectPermissions: async () => {
        rejected = true;
        return null;
      },
      storage,
      updateLiveStateCache: () => {},
    });

    expect(rejected).toBe(false);
    expect(storage.alarmAt).toBeNull();
  });
});
