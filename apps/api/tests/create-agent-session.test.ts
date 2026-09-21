import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { hydrateCachedRunContextFromSession } from "../src/modules/runtime/application/session-definition/hydrate-run-context.service";
import { parseSessionExecutionPlanJson } from "../src/modules/runtime/application/session-definition/session-execution.repository";
import { createAgentSession } from "../src/modules/runtime/application/session-run.service";
import { PREVIEW_RETENTION_MS } from "../src/modules/sessions/domain/preview-retention-policy";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createApiCommandQueueStub,
  PublicApiMemoryFileBucket,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

async function withProviderProbeMock<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      data: [{ id: "gpt-5.4" }],
    });

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withProviderProbeFailure<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("network down");
  };

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("createAgentSession", () => {
  test("enrolls only new Cloud console Previews and preserves the policy through parsing", async () => {
    const database = await createPublicHttpContractDatabase();
    for (const scenario of [
      { cloud: true, console: true, type: "preview" as const, managed: true },
      { cloud: true, console: true, type: "ui" as const, managed: false },
      { cloud: false, console: true, type: "preview" as const, managed: false },
      { cloud: true, console: false, type: "preview" as const, managed: false },
    ]) {
      const session = await withProviderProbeMock(() =>
        createAgentSession({
          bindings: {
            ...createPublicHttpTestBindings(database),
            ...(scenario.cloud ? { MOSOO_DEPLOYMENT_MODE: "cloud" } : {}),
          } as ApiBindings,
          input: {
            agentId: PUBLIC_API_TEST_IDS.agent,
            projectId: PUBLIC_API_TEST_IDS.project,
            type: scenario.type,
          },
          ...(scenario.console ? { options: { origin: "console_preview" as const } } : {}),
          viewer: OWNER_VIEWER,
        }),
      );
      const snapshot = await database
        .prepare("SELECT plan_json FROM session_execution_snapshot WHERE session_id = ?")
        .bind(session.id)
        .first<{ plan_json: string }>();
      expect(snapshot).not.toBeNull();
      const plan = parseSessionExecutionPlanJson(snapshot!.plan_json);
      expect(plan.previewRetentionMs).toBe(scenario.managed ? PREVIEW_RETENTION_MS : undefined);
      if (scenario.managed) {
        expect(() =>
          parseSessionExecutionPlanJson(
            JSON.stringify({ ...plan, previewRetentionMs: 3 * 86_400_000 }),
          ),
        ).toThrow("must be 30 days");
      }
    }
  });

  test("returns the created Session summary", async () => {
    const database = await createPublicHttpContractDatabase();

    const session = await withProviderProbeMock(() =>
      createAgentSession({
        bindings: createPublicHttpTestBindings(database) as ApiBindings,
        input: {
          agentId: PUBLIC_API_TEST_IDS.agent,
          projectId: PUBLIC_API_TEST_IDS.project,
          type: "preview",
        },
        viewer: OWNER_VIEWER,
      }),
    );

    expect(session).toMatchObject({
      agentId: PUBLIC_API_TEST_IDS.agent,
      deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
      deploymentVersionNumber: 1,
      kind: "pet",
      lastRun: null,
      model: "gpt-5.4",
      provider: "openai",
      projectId: PUBLIC_API_TEST_IDS.project,
      runtimeId: "openai-runtime",
      status: "IDLE",
      title: null,
      type: "preview",
    });
    expect(session.id).toBeString();
    expect(session.createdAt).toBe(session.updatedAt);
  });

  test("saved v2 admission isolates each Session without moving the Agent's legacy shared workspace", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const create = (saved: boolean) =>
      withProviderProbeMock(() =>
        createAgentSession({
          bindings,
          input: {
            agentId: PUBLIC_API_TEST_IDS.agent,
            projectId: PUBLIC_API_TEST_IDS.project,
            type: "ui",
          },
          ...(saved ? { options: { configurationSource: "saved" as const } } : {}),
          viewer: OWNER_VIEWER,
        }),
      );
    const legacy = await create(false);
    const legacyContext = await hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, legacy);
    const before = await database
      .prepare("SELECT * FROM session_execution_snapshot WHERE session_id = ?")
      .bind(legacy.id)
      .first();
    const first = await create(true);
    const second = await create(true);
    const firstContext = await hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, first);
    const secondContext = await hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, second);
    expect(legacyContext.value.profile.sandbox.subjectId).toBe(PUBLIC_API_TEST_IDS.agent);
    expect(firstContext.value.profile.sandbox.subjectId).toBe(first.id);
    expect(secondContext.value.profile.sandbox.subjectId).toBe(second.id);
    expect(
      new Set([
        legacyContext.value.profile.sandbox.id,
        firstContext.value.profile.sandbox.id,
        secondContext.value.profile.sandbox.id,
      ]).size,
    ).toBe(3);
    expect(firstContext.value.profile.session.homePath).not.toBe(
      secondContext.value.profile.session.homePath,
    );
    expect(firstContext.value.profile.session.sessionOrganizationPath).not.toBe(
      secondContext.value.profile.session.sessionOrganizationPath,
    );
    for (const session of [first, second]) {
      const row = await database
        .prepare("SELECT plan_json FROM session_execution_snapshot WHERE session_id = ?")
        .bind(session.id)
        .first<{ plan_json: string }>();
      expect(JSON.parse(row?.plan_json ?? "{}").recoveryRetentionMs).toBe(30 * 24 * 60 * 60 * 1000);
      expect(session.kind).toBe("cattle");
    }
    expect(
      await database
        .prepare("SELECT kind FROM agent WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.agent)
        .first(),
    ).toEqual({ kind: "pet" });
    expect(
      await database
        .prepare("SELECT * FROM session_execution_snapshot WHERE session_id = ?")
        .bind(legacy.id)
        .first(),
    ).toEqual(before);
    const legacyAgain = await hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, legacy);
    expect(legacyAgain.value.profile.sandbox).toEqual(legacyContext.value.profile.sandbox);
  });

  test("freezes provider options across cold hydration, cache refresh, and later Agent edits", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await database
      .prepare(
        "UPDATE agent SET status = 'draft', live_deployment_version_id = NULL, config_json = ? WHERE id = ?",
      )
      .bind(
        JSON.stringify({
          packageMcpServers: [],
          packageSkills: [],
          packageResolution: null,
          providerOptions: { reasoningEffort: "low" },
        }),
        PUBLIC_API_TEST_IDS.agent,
      )
      .run();
    const createSession = () =>
      withProviderProbeMock(() =>
        createAgentSession({
          bindings,
          input: {
            agentId: PUBLIC_API_TEST_IDS.agent,
            projectId: PUBLIC_API_TEST_IDS.project,
            type: "ui",
          },
          viewer: OWNER_VIEWER,
        }),
      );
    const original = await createSession();
    await database
      .prepare("UPDATE agent SET config_json = ? WHERE id = ?")
      .bind(
        JSON.stringify({
          packageMcpServers: [],
          packageSkills: [],
          packageResolution: null,
          providerOptions: { reasoningEffort: "high" },
        }),
        PUBLIC_API_TEST_IDS.agent,
      )
      .run();
    const cold = await hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, original);
    expect(cold.cacheHit).toBe(false);
    expect(cold.value.profile.providerOptions).toEqual({ reasoningEffort: "low" });
    const warm = await hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, original);
    expect(warm.cacheHit).toBe(true);
    expect(warm.value.profile.providerOptions).toEqual({ reasoningEffort: "low" });
    const latest = await createSession();
    const latestContext = await hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, latest);
    expect(latestContext.value.profile.providerOptions).toEqual({ reasoningEffort: "high" });
    await database.prepare("DELETE FROM vendor_credential").run();
    await expect(
      hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, original),
    ).rejects.toThrow("No credential available");
  });

  test("reads legacy published configuration but never falls back from a corrupt new snapshot", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const session = await withProviderProbeMock(() =>
      createAgentSession({
        bindings,
        input: {
          agentId: PUBLIC_API_TEST_IDS.agent,
          projectId: PUBLIC_API_TEST_IDS.project,
          type: "ui",
        },
        viewer: OWNER_VIEWER,
      }),
    );
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_remove(plan_json, '$.configJson') WHERE session_id = ?",
      )
      .bind(session.id)
      .run();
    await database
      .prepare("UPDATE agent SET config_json = ? WHERE id = ?")
      .bind(
        JSON.stringify({
          packageMcpServers: [],
          packageSkills: [],
          packageResolution: null,
          providerOptions: { reasoningEffort: "high" },
        }),
        PUBLIC_API_TEST_IDS.agent,
      )
      .run();
    const legacy = await hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, session);
    expect(legacy.value.profile.providerOptions).toEqual({});
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.configJson', 'broken') WHERE session_id = ?",
      )
      .bind(session.id)
      .run();
    await expect(
      hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, session),
    ).rejects.toThrow();
    await database
      .prepare(
        "UPDATE session_execution_snapshot SET plan_json = json_set(plan_json, '$.configJson', NULL) WHERE session_id = ?",
      )
      .bind(session.id)
      .run();
    await expect(
      hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, session),
    ).rejects.toThrow("sessionExecutionPlan.configJson must be a string");
  });

  test.each(["retained", "absent"] as const)(
    "hydrates frozen isolated execution with %s Agent provenance, including cache refresh",
    async (provenance) => {
      const database = await createPublicHttpContractDatabase();
      const bindings = createPublicHttpTestBindings(database) as ApiBindings;
      const session = await withProviderProbeMock(() =>
        createAgentSession({
          bindings,
          input: {
            agentId: PUBLIC_API_TEST_IDS.agent,
            projectId: PUBLIC_API_TEST_IDS.project,
            type: "ui",
          },
          options: { configurationSource: "saved" },
          viewer: OWNER_VIEWER,
        }),
      );
      await database.prepare("DELETE FROM agent WHERE id = ?").bind(session.agentId).run();

      if (provenance === "absent") {
        const snapshot = await database
          .prepare("SELECT plan_json FROM session_execution_snapshot WHERE session_id = ?")
          .bind(session.id)
          .first<{ plan_json: string }>();
        const plan = parseSessionExecutionPlanJson(snapshot!.plan_json);
        const directPlan = {
          ...plan,
          binding: {
            ...plan.binding,
            agentId: null,
            deploymentVersionId: null,
            deploymentVersionNumber: null,
          },
        };
        for (const invalidBinding of [
          { ...directPlan.binding, kind: "pet" },
          { ...directPlan.binding, deploymentVersionId: PUBLIC_API_TEST_IDS.deployment },
          { ...directPlan.binding, deploymentVersionNumber: 1 },
        ]) {
          expect(() =>
            parseSessionExecutionPlanJson(
              JSON.stringify({ ...directPlan, binding: invalidBinding }),
            ),
          ).toThrow("requires isolated execution and no deployment revision");
        }
        await database
          .prepare(
            "UPDATE session SET agent_id = NULL, deployment_version_id = NULL, deployment_version_number = NULL WHERE id = ?",
          )
          .bind(session.id)
          .run();
        await database
          .prepare("UPDATE session_execution_snapshot SET plan_json = ? WHERE session_id = ?")
          .bind(JSON.stringify({ ...directPlan, configJson: undefined }), session.id)
          .run();
        await expect(
          hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, session),
        ).rejects.toThrow("A direct Session requires its frozen execution configuration");
        await database
          .prepare("UPDATE session_execution_snapshot SET plan_json = ? WHERE session_id = ?")
          .bind(JSON.stringify(directPlan), session.id)
          .run();
      }

      const cold = await hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, session);
      expect(cold.cacheHit).toBe(false);
      expect(cold.value.profile.model).toBe(session.model);
      expect(cold.value.profile.session.origin.executionOwnerUserId).toBe(OWNER_VIEWER.id);
      expect(cold.value.profile.vendorCredential.projectId).toBe(session.projectId);
      expect(cold.value.profile.sandbox.subjectId).toBe(session.id);
      expect(cold.value.profile.configRevision.agentId).toBe(
        provenance === "absent" ? null : session.agentId,
      );
      const warm = await hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, session);
      expect(warm.cacheHit).toBe(true);
      expect(warm.value.profile.configRevision).toEqual(cold.value.profile.configRevision);

      await expect(
        hydrateCachedRunContextFromSession(
          bindings,
          { ...OWNER_VIEWER, projectId: "01J00000000000000000000099" },
          session,
        ),
      ).rejects.toThrow("permission");
      await expect(
        hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, {
          ...session,
          projectId: "01J00000000000000000000099",
        }),
      ).rejects.toThrow("permission");
      await database
        .prepare("UPDATE project SET owner_account_id = ? WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.outsiderAccount, session.projectId)
        .run();
      await expect(
        hydrateCachedRunContextFromSession(bindings, OWNER_VIEWER, session),
      ).rejects.toThrow("permission");
    },
  );

  test("fails Public Thread session creation when the live version is missing", async () => {
    const database = await createPublicHttpContractDatabase();
    database.execute("PRAGMA ignore_check_constraints = ON");
    await database
      .prepare("UPDATE agent SET live_deployment_version_id = NULL WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.agent)
      .run();
    database.execute("PRAGMA ignore_check_constraints = OFF");

    await expect(
      createAgentSession({
        bindings: createPublicHttpTestBindings(database) as ApiBindings,
        input: {
          agentId: PUBLIC_API_TEST_IDS.agent,
          projectId: PUBLIC_API_TEST_IDS.project,
          type: "preview",
        },
        viewer: OWNER_VIEWER,
      }),
    ).rejects.toMatchObject({
      code: "AGENT_LIVE_VERSION_REQUIRED",
      status: 409,
    });

    const sessionCount = await database
      .prepare('SELECT COUNT(*) AS count FROM "session"')
      .first<{ count: number }>();
    const versionCount = await database
      .prepare("SELECT COUNT(*) AS count FROM agent_deployment_version")
      .first<{ count: number }>();
    expect(sessionCount?.count).toBe(0);
    expect(versionCount?.count).toBe(1);
  });

  test("rejects runtime readiness wait for UI session creation", async () => {
    const database = await createPublicHttpContractDatabase();

    await expect(
      withProviderProbeMock(() =>
        createAgentSession({
          bindings: createPublicHttpTestBindings(database) as ApiBindings,
          input: {
            agentId: PUBLIC_API_TEST_IDS.agent,
            projectId: PUBLIC_API_TEST_IDS.project,
            type: "ui",
            waitForRuntimeReady: true,
          },
          requestUrl: "https://api.example.com/graphql",
          viewer: OWNER_VIEWER,
        }),
      ),
    ).rejects.toMatchObject({
      code: "RUNTIME_READY_WAIT_UNSUPPORTED",
      status: 400,
    });

    const row = await database
      .prepare('SELECT COUNT(*) AS count FROM "session"')
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  test("returns a validation error when readiness blocks session creation", async () => {
    const database = await createPublicHttpContractDatabase();

    await expect(
      withProviderProbeFailure(() =>
        createAgentSession({
          bindings: createPublicHttpTestBindings(database) as ApiBindings,
          input: {
            agentId: PUBLIC_API_TEST_IDS.agent,
            projectId: PUBLIC_API_TEST_IDS.project,
            type: "preview",
          },
          viewer: OWNER_VIEWER,
        }),
      ),
    ).rejects.toMatchObject({
      code: "AGENT_SESSION_NOT_READY",
      status: 400,
    });

    const row = await database
      .prepare('SELECT COUNT(*) AS count FROM "session"')
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  test("does not create a Session while Environment packages are preparing", async () => {
    const database = await createPublicHttpContractDatabase();
    await database
      .prepare("UPDATE environment_revision SET packages_json = ? WHERE id = ?")
      .bind(
        JSON.stringify([{ manager: "pip", packages: ["requests==2.32.4"] }]),
        PUBLIC_API_TEST_IDS.environmentRevision,
      )
      .run();
    const bindings = {
      ...createPublicHttpTestBindings(database),
      ENVIRONMENT_ARTIFACT_BUILD_QUEUE: createApiCommandQueueStub(),
      SANDBOX_STATE_BUCKET: new PublicApiMemoryFileBucket(),
    } as ApiBindings;

    await expect(
      withProviderProbeMock(() =>
        createAgentSession({
          bindings,
          input: {
            agentId: PUBLIC_API_TEST_IDS.agent,
            projectId: PUBLIC_API_TEST_IDS.project,
            type: "preview",
          },
          viewer: OWNER_VIEWER,
        }),
      ),
    ).rejects.toMatchObject({ code: "ENVIRONMENT_ARTIFACT_PREPARING" });

    const row = await database
      .prepare('SELECT COUNT(*) AS count FROM "session"')
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});
