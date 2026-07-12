import { describe, expect, test } from "bun:test";

import {
  createAppVibeApp,
  createAppVibeAppCloneUrl,
  deleteAppVibeApp,
  getAppVibeApp,
  publishAppVibeApp,
  refreshAppVibeAppPreview,
  runVibeAppCreate,
  sendAppVibeAppPrompt,
} from "../src/modules/apps/application/vibe-app.service";
import type {
  VibeAppSnapshot,
  VibesdkGateway,
} from "../src/modules/apps/application/vibesdk-gateway";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createApiError, API_ERROR_CODE } from "../src/platform/errors";
import { createApiTestFixture } from "./helpers/api-test-fixture";

type Fixture = Awaited<ReturnType<typeof createApiTestFixture>>;

const SNAPSHOT: VibeAppSnapshot = {
  lastPublishedAt: null,
  previewUrl: "https://preview.test",
  productionUrl: null,
  status: "generating",
  title: "Todo App",
  updatedAt: "2026-07-12T00:00:00.000Z",
};

interface FakeGatewayOptions {
  onCreateApp?: (prompt: string) => Promise<string>;
  onDeleteApp?: (vibeAppId: string) => Promise<void>;
  snapshot?: VibeAppSnapshot;
}

function createFakeGateway(options: FakeGatewayOptions = {}) {
  const calls: { args: unknown[]; method: string }[] = [];
  const record = (method: string, ...args: unknown[]) => {
    calls.push({ args, method });
  };

  const gateway: VibesdkGateway = {
    createApp: async (prompt) => {
      record("createApp", prompt);
      return options.onCreateApp ? options.onCreateApp(prompt) : "vibe-1";
    },
    createCloneUrl: async (vibeAppId) => {
      record("createCloneUrl", vibeAppId);
      return { cloneUrl: `https://git.test/${vibeAppId}.git`, expiresAt: "2026-07-12T01:00:00Z" };
    },
    deleteApp: async (vibeAppId) => {
      record("deleteApp", vibeAppId);
      if (options.onDeleteApp) {
        await options.onDeleteApp(vibeAppId);
      }
    },
    getApp: async (vibeAppId) => {
      record("getApp", vibeAppId);
      return options.snapshot ?? SNAPSHOT;
    },
    publish: async (vibeAppId) => {
      record("publish", vibeAppId);
    },
    refreshPreview: async (vibeAppId) => {
      record("refreshPreview", vibeAppId);
    },
    sendPrompt: async (vibeAppId, prompt) => {
      record("sendPrompt", vibeAppId, prompt);
    },
  };

  return { calls, gateway };
}

function makeForeignViewer(): AuthenticatedViewer {
  return {
    email: "foreign@example.com",
    emailVerified: true,
    id: "01J000000000000000000000F1",
    imageUrl: null,
    name: "Foreign Viewer",
  };
}

async function readQueuedCreatePayload(fixture: Fixture): Promise<{
  bindingId: string;
  prompt: string;
} | null> {
  const row = await fixture.database
    .prepare("SELECT payload_json FROM api_command WHERE kind = 'vibe_app_create' LIMIT 1")
    .first<{ payload_json: string }>();
  return row === null
    ? null
    : (JSON.parse(row.payload_json) as { bindingId: string; prompt: string });
}

/** Create the binding and run the queued build to the attached state. */
async function createAttachedVibeApp(fixture: Fixture, vibeAppId = "vibe-1") {
  const { gateway } = createFakeGateway({ onCreateApp: async () => vibeAppId });
  const creating = await createAppVibeApp(fixture.bindings, gateway, fixture.viewer, {
    appId: fixture.ids.appId,
    prompt: "Build a todo app",
  });
  const payload = await readQueuedCreatePayload(fixture);

  if (payload === null) {
    throw new Error("Expected a queued vibe_app_create command.");
  }

  await runVibeAppCreate(fixture.bindings, payload, gateway);
  return creating;
}

describe("vibe app create (mutation)", () => {
  test("persists a creating binding and enqueues the build", async () => {
    const fixture = await createApiTestFixture();
    const { calls, gateway } = createFakeGateway();

    const created = await createAppVibeApp(fixture.bindings, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
      prompt: "  Build a todo app  ",
    });

    // The slow remote build is queued, never run inside the mutation.
    expect(calls).toEqual([]);
    expect(created).toMatchObject({
      appId: fixture.ids.appId,
      previewUrl: null,
      productionUrl: null,
      status: "creating",
      title: null,
      vibeAppId: null,
    });

    const payload = await readQueuedCreatePayload(fixture);
    expect(payload).toEqual({ bindingId: created.id, prompt: "Build a todo app" });

    const fetched = await getAppVibeApp(
      fixture.bindings.DB,
      null,
      fixture.viewer,
      fixture.ids.appId,
    );
    expect(fetched?.status).toBe("creating");
  });

  test("rejects a second vibe app for the same App", async () => {
    const fixture = await createApiTestFixture();
    await createAttachedVibeApp(fixture);
    const { gateway } = createFakeGateway();

    await expect(
      createAppVibeApp(fixture.bindings, gateway, fixture.viewer, {
        appId: fixture.ids.appId,
        prompt: "Another app",
      }),
    ).rejects.toMatchObject({ code: API_ERROR_CODE.vibeAppExists });
  });

  const invalidPromptCases = [
    { name: "empty", prompt: "" },
    { name: "whitespace-only", prompt: "   " },
  ] as const;

  for (const { name, prompt } of invalidPromptCases) {
    test(`rejects a ${name} prompt`, async () => {
      const fixture = await createApiTestFixture();
      const { gateway } = createFakeGateway();

      await expect(
        createAppVibeApp(fixture.bindings, gateway, fixture.viewer, {
          appId: fixture.ids.appId,
          prompt,
        }),
      ).rejects.toMatchObject({ code: API_ERROR_CODE.validationFailed });
      expect(await readQueuedCreatePayload(fixture)).toBeNull();
    });
  }

  test("fails closed when the gateway is unconfigured", async () => {
    const fixture = await createApiTestFixture();

    await expect(
      createAppVibeApp(fixture.bindings, null, fixture.viewer, {
        appId: fixture.ids.appId,
        prompt: "Build a todo app",
      }),
    ).rejects.toMatchObject({ code: API_ERROR_CODE.vibeAppUnconfigured });
    expect(await readQueuedCreatePayload(fixture)).toBeNull();
  });

  test("fails closed for viewers that do not own the App", async () => {
    const fixture = await createApiTestFixture();
    const { gateway } = createFakeGateway();

    await expect(
      createAppVibeApp(fixture.bindings, gateway, makeForeignViewer(), {
        appId: fixture.ids.appId,
        prompt: "Build a todo app",
      }),
    ).rejects.toThrow("You do not have permission");
  });
});

describe("vibe app create (queued build)", () => {
  test("attaches the remote app to the creating binding", async () => {
    const fixture = await createApiTestFixture();
    const created = await createAttachedVibeApp(fixture, "vibe-attached");

    const { gateway } = createFakeGateway();
    const fetched = await getAppVibeApp(
      fixture.bindings.DB,
      gateway,
      fixture.viewer,
      fixture.ids.appId,
    );

    expect(fetched?.id).toBe(created.id);
    expect(fetched?.vibeAppId).toBe("vibe-attached");
    expect(fetched?.status).toBe(SNAPSHOT.status);
  });

  test("deletes the binding when the remote build fails", async () => {
    const fixture = await createApiTestFixture();
    const { gateway } = createFakeGateway();
    await createAppVibeApp(fixture.bindings, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
      prompt: "Build a todo app",
    });
    const payload = await readQueuedCreatePayload(fixture);
    const { gateway: failingGateway } = createFakeGateway({
      onCreateApp: async () => {
        throw createApiError(API_ERROR_CODE.vibeAppUnavailable, "VibeSDK create failed: boom");
      },
    });

    await runVibeAppCreate(fixture.bindings, payload!, failingGateway);

    expect(
      await getAppVibeApp(fixture.bindings.DB, null, fixture.viewer, fixture.ids.appId),
    ).toBeNull();
  });

  test("deletes the binding when the gateway is unconfigured at build time", async () => {
    const fixture = await createApiTestFixture();
    const { gateway } = createFakeGateway();
    await createAppVibeApp(fixture.bindings, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
      prompt: "Build a todo app",
    });
    const payload = await readQueuedCreatePayload(fixture);

    await runVibeAppCreate(fixture.bindings, payload!, null);

    expect(
      await getAppVibeApp(fixture.bindings.DB, null, fixture.viewer, fixture.ids.appId),
    ).toBeNull();
  });

  test("deletes the fresh remote app when the binding vanished during the build", async () => {
    const fixture = await createApiTestFixture();
    const { gateway } = createFakeGateway();
    await createAppVibeApp(fixture.bindings, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
      prompt: "Build a todo app",
    });
    const payload = await readQueuedCreatePayload(fixture);

    const { calls, gateway: racingGateway } = createFakeGateway({
      onCreateApp: async () => {
        // The owner cancels while the remote build is still running.
        await deleteAppVibeApp(fixture.bindings.DB, null, fixture.viewer, {
          appId: fixture.ids.appId,
        });
        return "vibe-orphan";
      },
    });

    await runVibeAppCreate(fixture.bindings, payload!, racingGateway);

    expect(calls).toContainEqual({ args: ["vibe-orphan"], method: "deleteApp" });
    expect(
      await getAppVibeApp(fixture.bindings.DB, null, fixture.viewer, fixture.ids.appId),
    ).toBeNull();
  });

  test("is a no-op for an already attached or missing binding", async () => {
    const fixture = await createApiTestFixture();
    await createAttachedVibeApp(fixture, "vibe-first");
    const payload = await readQueuedCreatePayload(fixture);
    const { calls, gateway } = createFakeGateway({ onCreateApp: async () => "vibe-second" });

    await runVibeAppCreate(fixture.bindings, payload!, gateway);
    await runVibeAppCreate(
      fixture.bindings,
      { bindingId: "01J000000000000000000000E9", prompt: "ghost" },
      gateway,
    );

    expect(calls).toEqual([]);
    const fetched = await getAppVibeApp(
      fixture.bindings.DB,
      createFakeGateway().gateway,
      fixture.viewer,
      fixture.ids.appId,
    );
    expect(fetched?.vibeAppId).toBe("vibe-first");
  });
});

describe("vibe app status", () => {
  test("returns null when the App has no vibe app, without touching the gateway", async () => {
    const fixture = await createApiTestFixture();

    const result = await getAppVibeApp(
      fixture.bindings.DB,
      null,
      fixture.viewer,
      fixture.ids.appId,
    );

    expect(result).toBeNull();
  });

  test("reports a creating binding without touching the gateway", async () => {
    const fixture = await createApiTestFixture();
    const { gateway } = createFakeGateway();
    await createAppVibeApp(fixture.bindings, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
      prompt: "Build a todo app",
    });

    const result = await getAppVibeApp(
      fixture.bindings.DB,
      null,
      fixture.viewer,
      fixture.ids.appId,
    );

    expect(result).toMatchObject({ status: "creating", vibeAppId: null });
  });

  const snapshotCases: { name: string; snapshot: VibeAppSnapshot }[] = [];

  for (const status of ["generating", "ready"] as const) {
    for (const previewUrl of [null, "https://preview.test"]) {
      for (const productionUrl of [null, "https://live.test"]) {
        snapshotCases.push({
          name: `${status} preview=${previewUrl !== null} production=${productionUrl !== null}`,
          snapshot: {
            lastPublishedAt: productionUrl === null ? null : "2026-07-11T23:00:00.000Z",
            previewUrl,
            productionUrl,
            status,
            title: "Todo App",
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        });
      }
    }
  }

  for (const { name, snapshot } of snapshotCases) {
    test(`merges the live snapshot: ${name}`, async () => {
      const fixture = await createApiTestFixture();
      await createAttachedVibeApp(fixture);
      const { gateway } = createFakeGateway({ snapshot });

      const result = await getAppVibeApp(
        fixture.bindings.DB,
        gateway,
        fixture.viewer,
        fixture.ids.appId,
      );

      expect(result).toMatchObject({
        lastPublishedAt: snapshot.lastPublishedAt,
        previewUrl: snapshot.previewUrl,
        productionUrl: snapshot.productionUrl,
        status: snapshot.status,
        title: snapshot.title,
        updatedAt: snapshot.updatedAt,
        vibeAppId: "vibe-1",
      });
    });
  }

  test("falls back to the binding timestamp when the snapshot has none", async () => {
    const fixture = await createApiTestFixture();
    await createAttachedVibeApp(fixture);
    const { gateway } = createFakeGateway({ snapshot: { ...SNAPSHOT, updatedAt: null } });

    const result = await getAppVibeApp(
      fixture.bindings.DB,
      gateway,
      fixture.viewer,
      fixture.ids.appId,
    );

    expect(result?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("fails closed when an attached binding has no configured gateway", async () => {
    const fixture = await createApiTestFixture();
    await createAttachedVibeApp(fixture);

    await expect(
      getAppVibeApp(fixture.bindings.DB, null, fixture.viewer, fixture.ids.appId),
    ).rejects.toMatchObject({ code: API_ERROR_CODE.vibeAppUnconfigured });
  });
});

describe("vibe app commands", () => {
  const commandCases = [
    {
      expectCall: (appId: string) => ({ args: [appId, "Add dark mode"], method: "sendPrompt" }),
      name: "sendPrompt",
      run: (fixture: Fixture, gateway: VibesdkGateway | null) =>
        sendAppVibeAppPrompt(fixture.bindings.DB, gateway, fixture.viewer, {
          appId: fixture.ids.appId,
          prompt: "Add dark mode",
        }),
    },
    {
      expectCall: (appId: string) => ({ args: [appId], method: "publish" }),
      name: "publish",
      run: (fixture: Fixture, gateway: VibesdkGateway | null) =>
        publishAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
          appId: fixture.ids.appId,
        }),
    },
    {
      expectCall: (appId: string) => ({ args: [appId], method: "refreshPreview" }),
      name: "refreshPreview",
      run: (fixture: Fixture, gateway: VibesdkGateway | null) =>
        refreshAppVibeAppPreview(fixture.bindings.DB, gateway, fixture.viewer, {
          appId: fixture.ids.appId,
        }),
    },
    {
      expectCall: (appId: string) => ({ args: [appId], method: "createCloneUrl" }),
      name: "createCloneUrl",
      run: (fixture: Fixture, gateway: VibesdkGateway | null) =>
        createAppVibeAppCloneUrl(fixture.bindings.DB, gateway, fixture.viewer, {
          appId: fixture.ids.appId,
        }),
    },
  ] as const;

  for (const command of commandCases) {
    test(`${command.name} forwards to the attached vibe app`, async () => {
      const fixture = await createApiTestFixture();
      await createAttachedVibeApp(fixture);
      const { calls, gateway } = createFakeGateway();

      await command.run(fixture, gateway);

      expect(calls).toEqual([command.expectCall("vibe-1")]);
    });

    test(`${command.name} rejects when the App has no vibe app`, async () => {
      const fixture = await createApiTestFixture();
      const { calls, gateway } = createFakeGateway();

      await expect(command.run(fixture, gateway)).rejects.toMatchObject({
        code: API_ERROR_CODE.notFound,
      });
      expect(calls).toEqual([]);
    });

    test(`${command.name} rejects while the vibe app is still creating`, async () => {
      const fixture = await createApiTestFixture();
      const { gateway } = createFakeGateway();
      await createAppVibeApp(fixture.bindings, gateway, fixture.viewer, {
        appId: fixture.ids.appId,
        prompt: "Build a todo app",
      });
      const { calls, gateway: commandGateway } = createFakeGateway();

      await expect(command.run(fixture, commandGateway)).rejects.toMatchObject({
        code: API_ERROR_CODE.validationFailed,
      });
      expect(calls).toEqual([]);
    });

    test(`${command.name} fails closed when the gateway is unconfigured`, async () => {
      const fixture = await createApiTestFixture();
      await createAttachedVibeApp(fixture);

      await expect(command.run(fixture, null)).rejects.toMatchObject({
        code: API_ERROR_CODE.vibeAppUnconfigured,
      });
    });
  }

  test("sendPrompt rejects an empty prompt before reading the binding", async () => {
    const fixture = await createApiTestFixture();
    const { calls, gateway } = createFakeGateway();

    await expect(
      sendAppVibeAppPrompt(fixture.bindings.DB, gateway, fixture.viewer, {
        appId: fixture.ids.appId,
        prompt: "  ",
      }),
    ).rejects.toMatchObject({ code: API_ERROR_CODE.validationFailed });
    expect(calls).toEqual([]);
  });
});

describe("vibe app delete", () => {
  test("is idempotent when the App has no vibe app", async () => {
    const fixture = await createApiTestFixture();
    const { calls, gateway } = createFakeGateway();

    const result = await deleteAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  test("removes a creating binding without a remote call", async () => {
    const fixture = await createApiTestFixture();
    const { gateway } = createFakeGateway();
    await createAppVibeApp(fixture.bindings, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
      prompt: "Build a todo app",
    });
    const { calls, gateway: deleteGateway } = createFakeGateway();

    const result = await deleteAppVibeApp(fixture.bindings.DB, deleteGateway, fixture.viewer, {
      appId: fixture.ids.appId,
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([]);
    expect(
      await getAppVibeApp(fixture.bindings.DB, null, fixture.viewer, fixture.ids.appId),
    ).toBeNull();
  });

  test("removes the remote app before the binding", async () => {
    const fixture = await createApiTestFixture();
    await createAttachedVibeApp(fixture);
    const { calls, gateway } = createFakeGateway();

    const result = await deleteAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ args: ["vibe-1"], method: "deleteApp" }]);
    expect(
      await getAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, fixture.ids.appId),
    ).toBeNull();
  });

  test("keeps the binding when the remote delete fails", async () => {
    const fixture = await createApiTestFixture();
    await createAttachedVibeApp(fixture);
    const { gateway } = createFakeGateway({
      onDeleteApp: async () => {
        throw createApiError(API_ERROR_CODE.vibeAppUnavailable, "VibeSDK delete failed: boom");
      },
    });

    await expect(
      deleteAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
        appId: fixture.ids.appId,
      }),
    ).rejects.toMatchObject({ code: API_ERROR_CODE.vibeAppUnavailable });

    const remaining = await getAppVibeApp(
      fixture.bindings.DB,
      createFakeGateway().gateway,
      fixture.viewer,
      fixture.ids.appId,
    );
    expect(remaining?.vibeAppId).toBe("vibe-1");
  });
});
