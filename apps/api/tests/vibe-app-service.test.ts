import { describe, expect, test } from "bun:test";

import {
  createAppVibeApp,
  createAppVibeAppCloneUrl,
  deleteAppVibeApp,
  getAppVibeApp,
  publishAppVibeApp,
  refreshAppVibeAppPreview,
  sendAppVibeAppPrompt,
} from "../src/modules/apps/application/vibe-app.service";
import type {
  VibeAppSnapshot,
  VibesdkGateway,
} from "../src/modules/apps/application/vibesdk-gateway";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createApiError, API_ERROR_CODE, isApiError } from "../src/platform/errors";
import { createApiTestFixture } from "./helpers/api-test-fixture";

type Fixture = Awaited<ReturnType<typeof createApiTestFixture>>;

const SNAPSHOT: VibeAppSnapshot = {
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

async function createVibeAppFixture(fixture: Fixture, vibeAppId = "vibe-1") {
  const { gateway } = createFakeGateway({ onCreateApp: async () => vibeAppId });
  return createAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
    appId: fixture.ids.appId,
    prompt: "Build a todo app",
  });
}

async function expectApiErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (!isApiError(error)) {
      throw error;
    }

    expect(error.code).toBe(code);
    return;
  }

  throw new Error(`Expected ApiError ${code} but the call succeeded.`);
}

describe("vibe app service", () => {
  test("create starts generation and persists the binding", async () => {
    const fixture = await createApiTestFixture();
    const { calls, gateway } = createFakeGateway();

    const created = await createAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
      prompt: "  Build a todo app  ",
    });

    expect(calls).toEqual([{ args: ["Build a todo app"], method: "createApp" }]);
    expect(created).toMatchObject({
      appId: fixture.ids.appId,
      previewUrl: null,
      productionUrl: null,
      status: "generating",
      title: null,
      vibeAppId: "vibe-1",
    });

    const fetched = await getAppVibeApp(
      fixture.bindings.DB,
      gateway,
      fixture.viewer,
      fixture.ids.appId,
    );
    expect(fetched?.id).toBe(created.id);
  });

  test("create rejects a second vibe app for the same App", async () => {
    const fixture = await createApiTestFixture();
    await createVibeAppFixture(fixture);
    const { calls, gateway } = createFakeGateway();

    await expectApiErrorCode(
      createAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
        appId: fixture.ids.appId,
        prompt: "Another app",
      }),
      API_ERROR_CODE.vibeAppExists,
    );
    expect(calls).toEqual([]);
  });

  test("create compensates the remote app when the insert races a duplicate", async () => {
    const fixture = await createApiTestFixture();
    const { calls, gateway } = createFakeGateway({
      onCreateApp: async () => {
        // Simulate a concurrent create winning between the pre-check and insert.
        await createVibeAppFixture(fixture, "vibe-winner");
        return "vibe-loser";
      },
    });

    await expectApiErrorCode(
      createAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
        appId: fixture.ids.appId,
        prompt: "Race entry",
      }),
      API_ERROR_CODE.vibeAppExists,
    );
    expect(calls).toContainEqual({ args: ["vibe-loser"], method: "deleteApp" });

    const survivor = await getAppVibeApp(
      fixture.bindings.DB,
      createFakeGateway().gateway,
      fixture.viewer,
      fixture.ids.appId,
    );
    expect(survivor?.vibeAppId).toBe("vibe-winner");
  });

  const invalidPromptCases = [
    { name: "empty", prompt: "" },
    { name: "whitespace-only", prompt: "   " },
  ] as const;

  for (const { name, prompt } of invalidPromptCases) {
    test(`create rejects a ${name} prompt`, async () => {
      const fixture = await createApiTestFixture();
      const { calls, gateway } = createFakeGateway();

      await expectApiErrorCode(
        createAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
          appId: fixture.ids.appId,
          prompt,
        }),
        API_ERROR_CODE.validationFailed,
      );
      expect(calls).toEqual([]);
    });
  }

  test("create fails closed when the gateway is unconfigured", async () => {
    const fixture = await createApiTestFixture();

    await expectApiErrorCode(
      createAppVibeApp(fixture.bindings.DB, null, fixture.viewer, {
        appId: fixture.ids.appId,
        prompt: "Build a todo app",
      }),
      API_ERROR_CODE.vibeAppUnconfigured,
    );
  });

  test("create fails closed for viewers that do not own the App", async () => {
    const fixture = await createApiTestFixture();
    const { calls, gateway } = createFakeGateway();

    await expect(
      createAppVibeApp(fixture.bindings.DB, gateway, makeForeignViewer(), {
        appId: fixture.ids.appId,
        prompt: "Build a todo app",
      }),
    ).rejects.toThrow("You do not have permission");
    expect(calls).toEqual([]);
  });

  test("status returns null when the App has no vibe app, without touching the gateway", async () => {
    const fixture = await createApiTestFixture();

    const result = await getAppVibeApp(
      fixture.bindings.DB,
      null,
      fixture.viewer,
      fixture.ids.appId,
    );

    expect(result).toBeNull();
  });

  const snapshotCases: { name: string; snapshot: VibeAppSnapshot }[] = [];

  for (const status of ["generating", "ready"] as const) {
    for (const previewUrl of [null, "https://preview.test"]) {
      for (const productionUrl of [null, "https://live.test"]) {
        snapshotCases.push({
          name: `${status} preview=${previewUrl !== null} production=${productionUrl !== null}`,
          snapshot: {
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
    test(`status merges the live snapshot: ${name}`, async () => {
      const fixture = await createApiTestFixture();
      await createVibeAppFixture(fixture);
      const { gateway } = createFakeGateway({ snapshot });

      const result = await getAppVibeApp(
        fixture.bindings.DB,
        gateway,
        fixture.viewer,
        fixture.ids.appId,
      );

      expect(result).toMatchObject({
        previewUrl: snapshot.previewUrl,
        productionUrl: snapshot.productionUrl,
        status: snapshot.status,
        title: snapshot.title,
        updatedAt: snapshot.updatedAt,
        vibeAppId: "vibe-1",
      });
    });
  }

  test("status falls back to the binding timestamp when the snapshot has none", async () => {
    const fixture = await createApiTestFixture();
    await createVibeAppFixture(fixture);
    const { gateway } = createFakeGateway({ snapshot: { ...SNAPSHOT, updatedAt: null } });

    const result = await getAppVibeApp(
      fixture.bindings.DB,
      gateway,
      fixture.viewer,
      fixture.ids.appId,
    );

    expect(result?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("status fails closed when a binding exists but the gateway is unconfigured", async () => {
    const fixture = await createApiTestFixture();
    await createVibeAppFixture(fixture);

    await expectApiErrorCode(
      getAppVibeApp(fixture.bindings.DB, null, fixture.viewer, fixture.ids.appId),
      API_ERROR_CODE.vibeAppUnconfigured,
    );
  });

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
  ] as const;

  for (const command of commandCases) {
    test(`${command.name} forwards to the bound vibe app`, async () => {
      const fixture = await createApiTestFixture();
      await createVibeAppFixture(fixture);
      const { calls, gateway } = createFakeGateway();

      const result = await command.run(fixture, gateway);

      expect(result).toEqual({ ok: true });
      expect(calls).toEqual([command.expectCall("vibe-1")]);
    });

    test(`${command.name} rejects when the App has no vibe app`, async () => {
      const fixture = await createApiTestFixture();
      const { calls, gateway } = createFakeGateway();

      await expectApiErrorCode(command.run(fixture, gateway), API_ERROR_CODE.notFound);
      expect(calls).toEqual([]);
    });

    test(`${command.name} fails closed when the gateway is unconfigured`, async () => {
      const fixture = await createApiTestFixture();
      await createVibeAppFixture(fixture);

      await expectApiErrorCode(command.run(fixture, null), API_ERROR_CODE.vibeAppUnconfigured);
    });
  }

  test("sendPrompt rejects an empty prompt before reading the binding", async () => {
    const fixture = await createApiTestFixture();
    const { calls, gateway } = createFakeGateway();

    await expectApiErrorCode(
      sendAppVibeAppPrompt(fixture.bindings.DB, gateway, fixture.viewer, {
        appId: fixture.ids.appId,
        prompt: "  ",
      }),
      API_ERROR_CODE.validationFailed,
    );
    expect(calls).toEqual([]);
  });

  test("clone url mints from the bound vibe app", async () => {
    const fixture = await createApiTestFixture();
    await createVibeAppFixture(fixture);
    const { gateway } = createFakeGateway();

    const result = await createAppVibeAppCloneUrl(fixture.bindings.DB, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
    });

    expect(result).toEqual({
      cloneUrl: "https://git.test/vibe-1.git",
      expiresAt: "2026-07-12T01:00:00Z",
    });
  });

  test("delete is idempotent when the App has no vibe app", async () => {
    const fixture = await createApiTestFixture();
    const { calls, gateway } = createFakeGateway();

    const result = await deleteAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
      appId: fixture.ids.appId,
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  test("delete removes the remote app before the binding", async () => {
    const fixture = await createApiTestFixture();
    await createVibeAppFixture(fixture);
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

  test("delete keeps the binding when the remote delete fails", async () => {
    const fixture = await createApiTestFixture();
    await createVibeAppFixture(fixture);
    const { gateway } = createFakeGateway({
      onDeleteApp: async () => {
        throw createApiError(API_ERROR_CODE.vibeAppUnavailable, "VibeSDK delete failed: boom");
      },
    });

    await expectApiErrorCode(
      deleteAppVibeApp(fixture.bindings.DB, gateway, fixture.viewer, {
        appId: fixture.ids.appId,
      }),
      API_ERROR_CODE.vibeAppUnavailable,
    );

    const remaining = await getAppVibeApp(
      fixture.bindings.DB,
      createFakeGateway().gateway,
      fixture.viewer,
      fixture.ids.appId,
    );
    expect(remaining?.vibeAppId).toBe("vibe-1");
  });
});
