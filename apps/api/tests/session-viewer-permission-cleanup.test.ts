import { describe, expect, test } from "bun:test";

import type { SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  runViewerPermissionCleanupAlarm,
  scheduleViewerPermissionCleanupAlarm,
  VIEWER_PERMISSION_CLEANUP_DELAY_MS,
} from "../src/modules/sessions/infrastructure/session/viewer-permission-cleanup";
import type { ViewerPermissionCleanupStorage } from "../src/modules/sessions/infrastructure/session/viewer-permission-cleanup";
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

function createAttachment(sessionId: SessionId = "session-1" as SessionId): ViewerSocketAttachment {
  return {
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
