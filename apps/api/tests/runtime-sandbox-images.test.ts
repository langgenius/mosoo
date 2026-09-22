import { describe, expect, mock, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import { PLATFORM_ID_FIXTURES as ids } from "@mosoo/id/testing";
import { PUBLIC_RUNTIME_CATALOG } from "@mosoo/runtime-catalog";

import {
  ensureRuntimeSubjectId,
  getRuntimeSubject,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-record-store";
import {
  requireCloudflareSandboxBinding,
  RUNTIME_SANDBOX_IMAGES,
} from "../src/platform/cloudflare/sandbox-binding";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const migrationsDirectory = new URL("../../../pkgs/db/drizzle/", import.meta.url);
const migrationTags = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .toSorted()
  .map((name) => name.slice(0, -4));
function applyDrizzleMigration(db: SqliteD1Database, tag: string): void {
  db.execute(readFileSync(new URL(`${tag}.sql`, migrationsDirectory), "utf8"));
}
function applyDrizzleMigrationsBefore(db: SqliteD1Database, tag: string): void {
  for (const current of migrationTags) {
    if (current === tag) break;
    applyDrizzleMigration(db, current);
  }
}
function applyDrizzleMigrations(db: SqliteD1Database): void {
  for (const tag of migrationTags) applyDrizzleMigration(db, tag);
}

const calls: { namespace: unknown; id: string }[] = [];
mock.module("@cloudflare/sandbox", () => ({
  getSandbox(namespace: unknown, id: string) {
    calls.push({ namespace, id });
    return new Proxy(
      {},
      {
        get: (_, name) => (name === "then" ? undefined : async () => undefined),
      },
    );
  },
}));
const {
  getRuntimeSubjectKeepAliveHandle,
  getRuntimeSubjectContainerObservation,
  destroyRuntimeSubjectContainer,
} =
  await import("../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-platform");

const allocation = {
  runtimeImagesEnabled: true,
  agentId: ids.agent,
  projectId: ids.project,
  executionOwnerUserId: ids.account,
  sessionId: ids.session,
  runtimeSubjectId: ids.sandbox,
} as const;
const profiles = Object.entries(RUNTIME_SANDBOX_IMAGES).map(
  ([runtimeId, image]) => [runtimeId, image.binding, image.profile] as const,
);

function seedSessionAuthority(db: SqliteD1Database): void {
  db.execute(`
    INSERT INTO project (id, name, organization_id, owner_account_id, created_at, updated_at)
    VALUES ('${ids.project}', 'Fixture', '${ids.organization}', '${ids.account}', 1, 1);
    INSERT INTO session (id, agent_id, project_id, creator_account_id, kind, model, provider,
      runtime_id, renamed, status, created_at, updated_at)
    VALUES ('${ids.session}', '${ids.agent}', '${ids.project}', '${ids.account}', 'cattle',
      'gpt-5.4', 'openai', 'openai-runtime', 0, 'IDLE', 1, 1);
  `);
}

function database(): SqliteD1Database {
  const db = new SqliteD1Database();
  applyDrizzleMigrations(db);
  seedSessionAuthority(db);
  return db;
}

describe("runtime-specific Sandbox images", () => {
  test("covers the product catalog and the pinned Driver image manifest exactly", () => {
    const images = JSON.parse(
      readFileSync(new URL("../../driver/runtime-images.json", import.meta.url), "utf8"),
    ) as { runtimeId: string; profile: string }[];
    expect(profiles.map(([runtimeId]) => runtimeId).toSorted()).toEqual(
      PUBLIC_RUNTIME_CATALOG.map((runtime) => runtime.runtimeId).toSorted(),
    );
    expect(
      Object.fromEntries(profiles.map(([runtimeId, , profile]) => [runtimeId, profile])),
    ).toEqual(Object.fromEntries(images.map((image) => [image.runtimeId, image.profile])));
  });

  test("keeps the pinned Sandbox image on the Worker SDK version", () => {
    const containerfile = readFileSync(
      new URL("../../driver/Containerfile", import.meta.url),
      "utf8",
    );
    const apiPackage = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies: { "@cloudflare/sandbox": string } };
    expect(containerfile).toContain(
      `cloudflare/sandbox:${apiPackage.dependencies["@cloudflare/sandbox"]}@sha256:`,
    );
  });

  test("disables new allocations during rollout without redirecting existing split subjects", async () => {
    for (const enabled of [false, true]) {
      const db = database();
      await ensureRuntimeSubjectId(db, {
        ...allocation,
        runtimeId: "claude-agent-sdk",
        runtimeImagesEnabled: enabled,
      });
      await ensureRuntimeSubjectId(db, {
        ...allocation,
        runtimeId: "claude-agent-sdk",
        runtimeImagesEnabled: false,
      });
      expect((await getRuntimeSubject(db, ids.sandbox))?.sandboxBinding).toBe(
        enabled ? "SandboxClaude" : "Sandbox",
      );
    }
  });

  test.each(profiles)(
    "pins %s through warm handles, Worker restarts, and teardown",
    async (runtimeId, binding) => {
      const db = database();
      await ensureRuntimeSubjectId(db, { ...allocation, runtimeId });
      expect((await getRuntimeSubject(db, ids.sandbox))?.sandboxBinding).toBe(binding);
      const namespace = { name: binding };
      // Separate binding objects stand in for a fresh Worker isolate: routing
      // comes from D1, never a process cache or current Agent configuration.
      for (let restart = 0; restart < 3; restart += 1) {
        const env = { DB: db, [binding]: namespace } as unknown as ApiBindings;
        await getRuntimeSubjectKeepAliveHandle(env, ids.sandbox);
        await destroyRuntimeSubjectContainer(env, ids.sandbox);
        expect(calls.at(-1)).toEqual({
          namespace,
          id: ids.sandbox,
        });
      }
      await expect(
        ensureRuntimeSubjectId(db, {
          ...allocation,
          runtimeId: runtimeId === "openai-runtime" ? "claude-agent-sdk" : "openai-runtime",
        }),
      ).rejects.toThrow("image does not match");
    },
  );

  test("preserves legacy namespaces when the additive migration meets existing data", async () => {
    const db = new SqliteD1Database();
    applyDrizzleMigrationsBefore(db, "0015_runtime-sandbox-images");
    seedSessionAuthority(db);
    db.execute(`INSERT INTO sandbox (id, agent_id, project_id, owner_account_id, kind, subject_kind, subject_id, status, created_at, updated_at)
      VALUES ('${ids.sandbox}', '${ids.agent}', '${ids.project}', '${ids.account}', 'cattle', 'session', '${ids.session}', 'cold', 1, 1)`);
    applyDrizzleMigration(db, "0015_runtime-sandbox-images");
    for (const [runtimeId] of profiles)
      await ensureRuntimeSubjectId(db, { ...allocation, runtimeId });
    expect((await getRuntimeSubject(db, ids.sandbox))?.sandboxBinding).toBe("Sandbox");
  });

  test("observes the recorded namespace without configuring an SDK handle", async () => {
    for (const sandboxBinding of ["Sandbox", ...profiles.map(([, binding]) => binding)]) {
      const db = database();
      await ensureRuntimeSubjectId(db, { ...allocation, runtimeId: "openai-runtime" });
      db.execute(`UPDATE sandbox SET sandbox_binding = '${sandboxBinding}'`);
      const sdkCalls = calls.length;
      const names: string[] = [];
      let disposed = 0;
      const namespace = {
        getByName(name: string) {
          names.push(name);
          return {
            getContainerObservation: async () => ({ state: "stopped", observedAt: 123 }),
            [Symbol.dispose]() {
              disposed++;
            },
          };
        },
      };
      const bindings = { DB: db, [sandboxBinding]: namespace } as unknown as ApiBindings;
      expect(await getRuntimeSubjectContainerObservation(bindings, ids.sandbox)).toEqual({
        state: "stopped",
        observedAt: 123,
      });
      expect(names).toEqual([ids.sandbox.toLowerCase()]);
      expect(disposed).toBe(1);
      expect(calls).toHaveLength(sdkCalls);
    }
  });

  test("observation does not fabricate stopped state for missing resources or failed RPCs", async () => {
    const db = database();
    const bindings = { DB: db } as ApiBindings;
    await expect(getRuntimeSubjectContainerObservation(bindings, ids.sandbox)).rejects.toThrow(
      "no recorded Sandbox binding",
    );
    await ensureRuntimeSubjectId(db, { ...allocation, runtimeId: "openai-runtime" });
    await expect(getRuntimeSubjectContainerObservation(bindings, ids.sandbox)).rejects.toThrow(
      "SandboxOpenAI binding is not configured",
    );
    let disposed = false;
    const failedBindings = {
      DB: db,
      SandboxOpenAI: {
        getByName: () => ({
          getContainerObservation: async () => {
            throw new Error("observation transport failed");
          },
          [Symbol.dispose]() {
            disposed = true;
          },
        }),
      },
    } as unknown as ApiBindings;
    await expect(
      getRuntimeSubjectContainerObservation(failedBindings, ids.sandbox),
    ).rejects.toThrow("observation transport failed");
    expect(disposed).toBe(true);
  });

  test("does not replace an old shared machine with a new image", async () => {
    const db = database();
    await ensureRuntimeSubjectId(db, { ...allocation, runtimeId: "openai-runtime" });
    db.execute(
      `UPDATE sandbox SET kind = 'pet', subject_kind = 'agent', subject_id = '${ids.agent}', sandbox_binding = 'Sandbox'`,
    );
    const before = await db.prepare("SELECT * FROM sandbox").all();
    for (const [runtimeId] of profiles) {
      await expect(ensureRuntimeSubjectId(db, { ...allocation, runtimeId })).rejects.toThrow(
        "verified exclusive execution binding",
      );
    }
    expect(await db.prepare("SELECT * FROM sandbox").all()).toEqual(before);
  });

  test("fails closed on unknown runtime, missing record, corrupt or unavailable binding", async () => {
    const db = database();
    const env = { DB: db } as ApiBindings;
    await expect(
      ensureRuntimeSubjectId(db, { ...allocation, runtimeId: "future-runtime" }),
    ).rejects.toThrow("No Sandbox image");
    await expect(getRuntimeSubjectKeepAliveHandle(env, ids.sandbox)).rejects.toThrow(
      "no recorded Sandbox binding",
    );
    await ensureRuntimeSubjectId(db, { ...allocation, runtimeId: "claude-agent-sdk" });
    await expect(getRuntimeSubjectKeepAliveHandle(env, ids.sandbox)).rejects.toThrow(
      "SandboxClaude binding is not configured",
    );
    db.execute(`UPDATE sandbox SET sandbox_binding = 'unknown' WHERE id = '${ids.sandbox}'`);
    await expect(getRuntimeSubjectKeepAliveHandle(env, ids.sandbox)).rejects.toThrow(
      "Unknown Sandbox binding",
    );
    expect(() => requireCloudflareSandboxBinding(env, "__proto__")).toThrow(
      "Unknown Sandbox binding",
    );
  });

  test("builds the matching profile and registers all classes in every environment", () => {
    const config = Bun.TOML.parse(
      readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"),
    );
    for (const environment of [
      config,
      (config.env as Record<string, unknown>).stage,
      (config.env as Record<string, unknown>).prod,
    ]) {
      const value = environment as {
        containers: Record<string, unknown>[];
        durable_objects: { bindings: Record<string, string>[] };
        migrations: { new_sqlite_classes?: string[] }[];
      };
      for (const [, binding, runtime] of profiles) {
        expect(value.containers.filter((entry) => entry.class_name === binding)).toEqual([
          expect.objectContaining({
            image: "../driver/Containerfile",
            image_vars: { RUNTIME: runtime },
          }),
        ]);
        expect(value.durable_objects.bindings).toContainEqual({
          name: binding,
          class_name: binding,
        });
        expect(value.migrations.flatMap((entry) => entry.new_sqlite_classes ?? [])).toContain(
          binding,
        );
      }
      expect(
        value.containers.find((entry) => entry.class_name === "Sandbox")?.image_vars,
      ).toBeUndefined();
    }
  });
});
