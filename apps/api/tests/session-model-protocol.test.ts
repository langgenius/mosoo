import { describe, expect, test } from "bun:test";

import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type { SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { hydrateCachedRunContextFromSession } from "../src/modules/runtime/application/session-definition/hydrate-run-context.service";
import { parseSessionExecutionPlanJson } from "../src/modules/runtime/application/session-definition/session-execution.repository";
import {
  createAgentSession,
  createProjectSession,
} from "../src/modules/runtime/application/session-run.service";
import { createVendorCredential } from "../src/modules/vendor-credentials/application/vendor-credential.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};
const MODEL_ID = "protocol-test-model";
const PROTOCOLS: PresetModelProtocol[] = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
  "google-gemini",
];

async function fixture(protocol: PresetModelProtocol = "openai-chat-completions") {
  const database = await createPublicHttpContractDatabase();
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const credential = await createVendorCredential(bindings, OWNER, {
    apiBase: "https://models.example.com/v1",
    apiKey: "protocol-fixture-key",
    modelProtocol: protocol,
    models: [MODEL_ID],
    name: "A custom provider",
    projectId: PUBLIC_API_TEST_IDS.project,
    vendorId: "openai-compatible",
  });
  return { database, bindings, credential };
}

async function withProbe<T>(operation: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [{ id: MODEL_ID }] });
  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createInline(bindings: ApiBindings, runtimeId = "pi") {
  return withProbe(() =>
    createProjectSession({
      bindings,
      input: {
        instructions: "Test frozen model protocols.",
        model: MODEL_ID,
        projectId: PUBLIC_API_TEST_IDS.project,
        provider: "openai-compatible",
        runtimeId,
      },
      viewer: OWNER,
    }),
  );
}

async function snapshot(database: SqliteD1Database, sessionId: SessionId) {
  const row = await database
    .prepare("SELECT plan_json FROM session_execution_snapshot WHERE session_id = ?")
    .bind(sessionId)
    .first<{ plan_json: string }>();
  if (!row) throw new Error("Expected a Session snapshot.");
  return row.plan_json;
}

describe("Session model protocol admission and freezing", () => {
  test("freezes the preset catalog protocol for Pi and saved Agent Sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const direct = await withProbe(() =>
      createProjectSession({
        bindings,
        input: {
          instructions: "Use the preset protocol.",
          model: "gpt-5.4",
          projectId: PUBLIC_API_TEST_IDS.project,
          provider: "openai",
          runtimeId: "pi",
        },
        viewer: OWNER,
      }),
    );
    const preset = await withProbe(() =>
      createAgentSession({
        bindings,
        input: { agentId: PUBLIC_API_TEST_IDS.agent, projectId: PUBLIC_API_TEST_IDS.project },
        viewer: OWNER,
      }),
    );
    for (const session of [direct, preset]) {
      expect(
        parseSessionExecutionPlanJson(await snapshot(database, session.id)).modelProtocol,
      ).toBe("openai-responses");
      const hydrated = await hydrateCachedRunContextFromSession(bindings, OWNER, session);
      expect(hydrated.value.profile.modelProtocol).toBe("openai-responses");
    }
  });

  test.each(PROTOCOLS)("freezes %s through cold and warm Pi hydration", async (protocol) => {
    const { bindings, credential, database } = await fixture(protocol);
    const session = await createInline(bindings);
    const plan = parseSessionExecutionPlanJson(await snapshot(database, session.id));
    expect(plan.modelProtocol).toBe(protocol);
    const cold = await hydrateCachedRunContextFromSession(bindings, OWNER, session);
    expect(cold.cacheHit).toBe(false);
    expect(cold.value.profile.modelProtocol).toBe(protocol);
    expect(cold.value.profile.vendorCredential.credentialId).toBe(credential.id);
    expect(cold.value.profile.vendorCredential.modelProtocol).toBe(protocol);
    const warm = await hydrateCachedRunContextFromSession(bindings, OWNER, session);
    expect(warm.cacheHit).toBe(true);
    expect(warm.value.profile.modelProtocol).toBe(protocol);
  });

  test.each(["cold", "warm"])("rejects protocol edits during %s continuation", async (path) => {
    const { bindings, credential, database } = await fixture();
    const session = await createInline(bindings);
    const admitted = await snapshot(database, session.id);
    if (path === "warm") await hydrateCachedRunContextFromSession(bindings, OWNER, session);
    await database
      .prepare("UPDATE vendor_credential SET model_protocol = 'openai-responses' WHERE id = ?")
      .bind(credential.id)
      .run();
    await expect(hydrateCachedRunContextFromSession(bindings, OWNER, session)).rejects.toThrow(
      "Restore the original protocol or start a new Session",
    );
    expect(await snapshot(database, session.id)).toBe(admitted);
    await database
      .prepare(
        "UPDATE vendor_credential SET model_protocol = 'openai-chat-completions' WHERE id = ?",
      )
      .bind(credential.id)
      .run();
    const restored = await hydrateCachedRunContextFromSession(bindings, OWNER, session);
    expect(restored.value.profile.modelProtocol).toBe("openai-chat-completions");
  });

  test.each(["inline", "preset"])(
    "rejects incompatible %s admission before creating a Session",
    async (source) => {
      const { bindings, database } = await fixture();
      const before = await database.prepare("SELECT count(*) AS count FROM session").first();
      const snapshotsBefore = await database
        .prepare("SELECT count(*) AS count FROM session_execution_snapshot")
        .first();
      if (source === "preset") {
        await database
          .prepare(
            "UPDATE agent SET status = 'draft', live_deployment_version_id = NULL, runtime_id = 'openai-runtime', provider = 'openai-compatible', model = ? WHERE id = ?",
          )
          .bind(MODEL_ID, PUBLIC_API_TEST_IDS.agent)
          .run();
      }
      const operation =
        source === "inline"
          ? () => createInline(bindings, "openai-runtime")
          : () =>
              withProbe(() =>
                createAgentSession({
                  bindings,
                  input: {
                    agentId: PUBLIC_API_TEST_IDS.agent,
                    projectId: PUBLIC_API_TEST_IDS.project,
                  },
                  viewer: OWNER,
                }),
              );
      await expect(operation()).rejects.toThrow("protocol");
      expect(await database.prepare("SELECT count(*) AS count FROM session").first()).toEqual(
        before,
      );
      expect(
        await database.prepare("SELECT count(*) AS count FROM session_execution_snapshot").first(),
      ).toEqual(snapshotsBefore);
    },
  );

  test("uses the same first custom credential for admission and frozen hydration", async () => {
    const { bindings, credential, database } = await fixture();
    await createVendorCredential(bindings, OWNER, {
      apiBase: "https://responses.example.com/v1",
      apiKey: "secondary-fixture-key",
      modelProtocol: "openai-responses",
      models: [MODEL_ID],
      name: "Z custom provider",
      projectId: PUBLIC_API_TEST_IDS.project,
      vendorId: "openai-compatible",
    });
    await expect(createInline(bindings, "openai-runtime")).rejects.toThrow("protocol");
    const session = await createInline(bindings);
    const hydrated = await hydrateCachedRunContextFromSession(bindings, OWNER, session);
    expect(hydrated.value.profile.vendorCredential.credentialId).toBe(credential.id);
    expect(parseSessionExecutionPlanJson(await snapshot(database, session.id)).modelProtocol).toBe(
      "openai-chat-completions",
    );
  });

  for (const runtimeId of ["openai-runtime", "acp-fallback", "pi"]) {
    test.each(["cold", "warm"])(
      `preserves the historical ${runtimeId} protocol for a legacy %s Session`,
      async (path) => {
        const { bindings, credential, database } = await fixture();
        await database
          .prepare("UPDATE vendor_credential SET model_protocol = NULL WHERE id = ?")
          .bind(credential.id)
          .run();
        const session = await createInline(bindings, runtimeId);
        await database
          .prepare(
            "UPDATE session_execution_snapshot SET plan_json = json_remove(plan_json, '$.modelProtocol') WHERE session_id = ?",
          )
          .bind(session.id)
          .run();
        const admitted = await snapshot(database, session.id);
        const expected =
          runtimeId === "openai-runtime" ? "openai-responses" : "openai-chat-completions";
        if (path === "warm") {
          const original = await hydrateCachedRunContextFromSession(bindings, OWNER, session);
          expect(original.value.profile.modelProtocol).toBe(expected);
        }
        await database
          .prepare("UPDATE vendor_credential SET model_protocol = ? WHERE id = ?")
          .bind(
            expected === "openai-responses" ? "openai-chat-completions" : "openai-responses",
            credential.id,
          )
          .run();
        await expect(hydrateCachedRunContextFromSession(bindings, OWNER, session)).rejects.toThrow(
          "Restore the original protocol or start a new Session",
        );
        expect(await snapshot(database, session.id)).toBe(admitted);
      },
    );
  }

  test("rejects corrupt protocol snapshots instead of taking the legacy path", async () => {
    const { bindings, database } = await fixture();
    const session = await createInline(bindings);
    const plan = parseSessionExecutionPlanJson(await snapshot(database, session.id));
    for (const modelProtocol of [null, "unknown-protocol", 1]) {
      expect(() =>
        parseSessionExecutionPlanJson(JSON.stringify({ ...plan, modelProtocol })),
      ).toThrow("modelProtocol must be a supported model protocol");
    }
  });
});
