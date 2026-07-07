import { describe, expect, test } from "bun:test";

import { MOSOO_NATIVE_SPEC } from "@mosoo/contracts/native-deployment";
import { createAgentManifestJson } from "@mosoo/contracts/native-repo-fixtures";
import { agentsTable } from "@mosoo/db";
import type { AppId } from "@mosoo/id";

import { upsertNativeRepoAgents } from "../src/modules/agents/application/agent-native-repo-upsert.service";
import type { NativeRepoUpsertOutcome } from "../src/modules/agents/application/agent-native-repo-upsert.service";
import { validateNativeDeployment } from "../src/modules/apps/application/native-deployment-validator";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  nowMsForTest,
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";
import { OWNER_VIEWER, withProviderProbeMock } from "./public-thread-api-fixtures";

const APP_ID = PUBLIC_API_TEST_IDS.app as AppId;
const NATIVE_MARKER_TOML = `spec = "${MOSOO_NATIVE_SPEC}"\n`;

function openaiAgentManifest(name: string, overrides: Record<string, unknown> = {}): string {
  return createAgentManifestJson(name, {
    model: "gpt-5.4",
    provider: "openai",
    runtime: "openai-runtime",
    ...overrides,
  });
}

function minimalRepoFiles(manifestOverrides: Record<string, unknown> = {}): Record<string, string> {
  return {
    ".agent/manifest.json": openaiAgentManifest("quiz-master", manifestOverrides),
    ".mosoo.toml": NATIVE_MARKER_TOML,
  };
}

async function createFixture() {
  const database = await createPublicHttpContractDatabase();

  database.execute(`
    CREATE TABLE IF NOT EXISTS skill_snapshot (
      id text PRIMARY KEY NOT NULL,
      author text NOT NULL,
      blob_key text NOT NULL,
      blob_sha256 text NOT NULL,
      blob_size integer NOT NULL,
      created_at integer NOT NULL,
      description text NOT NULL,
      name text NOT NULL,
      app_id text NOT NULL,
      skill_markdown_path text NOT NULL,
      uncompressed_size integer NOT NULL,
      version text
    );

    CREATE UNIQUE INDEX IF NOT EXISTS skill_snapshot_blob_sha256_idx
      ON skill_snapshot (app_id, blob_sha256);

    CREATE TABLE IF NOT EXISTS skill_snapshot_entry (
      entry_kind text NOT NULL,
      is_executable integer NOT NULL,
      mime_type text,
      path text NOT NULL,
      sha256 text,
      size integer NOT NULL,
      snapshot_id text NOT NULL,
      PRIMARY KEY (snapshot_id, path)
    );
  `);

  const bindings = createPublicHttpTestBindings(database, {
    fileBucket: new PublicApiMemoryFileBucket() as unknown as R2Bucket,
  }) as ApiBindings;

  return { bindings, database };
}

async function deployRepo(
  bindings: ApiBindings,
  files: Readonly<Record<string, string>>,
): Promise<NativeRepoUpsertOutcome> {
  const validate = validateNativeDeployment({ files });
  const facts = validate.facts;

  if (facts === null || !validate.valid) {
    throw new Error(
      `Test repo must validate green: ${validate.failures.map((failure) => failure.code).join(", ")}`,
    );
  }

  return withProviderProbeMock(() =>
    upsertNativeRepoAgents(bindings, OWNER_VIEWER, {
      agents: facts.agents,
      appId: APP_ID,
      files,
    }),
  );
}

async function readAgentRowByName(database: SqliteD1Database, name: string) {
  return database
    .prepare(
      `
        SELECT id, environment_id, live_deployment_version_id, prompt, status, updated_at
          FROM agent
         WHERE app_id = ? AND name = ?
      `,
    )
    .bind(APP_ID, name)
    .first<{
      environment_id: string | null;
      id: string;
      live_deployment_version_id: string | null;
      prompt: string;
      status: string;
      updated_at: number;
    }>();
}

async function countRows(database: SqliteD1Database, sql: string, ...binds: string[]) {
  const row = await database
    .prepare(sql)
    .bind(...binds)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

describe("upsertNativeRepoAgents", () => {
  test("creates and auto-publishes a new repo agent", async () => {
    const { bindings, database } = await createFixture();

    const outcome = await deployRepo(bindings, minimalRepoFiles());

    expect(outcome.blocking).toBeUndefined();
    expect(outcome.results).toEqual([
      {
        action: "created",
        agentId: expect.any(String),
        name: "quiz-master",
        versionNumber: 1,
      },
    ]);

    const row = await readAgentRowByName(database, "quiz-master");

    expect(row).toMatchObject({ status: "published" });
    expect(row?.live_deployment_version_id).toBeTruthy();

    const versionCount = await countRows(
      database,
      "SELECT COUNT(*) AS count FROM agent_deployment_version WHERE agent_id = ?",
      row?.id ?? "",
    );

    expect(versionCount).toBe(1);
  });

  test("re-deploying an identical repo reports unchanged and mints nothing", async () => {
    const { bindings, database } = await createFixture();
    const files = minimalRepoFiles();

    await deployRepo(bindings, files);
    const before = await readAgentRowByName(database, "quiz-master");
    const second = await deployRepo(bindings, files);

    expect(second.blocking).toBeUndefined();
    expect(second.results).toEqual([
      {
        action: "unchanged",
        agentId: before?.id,
        name: "quiz-master",
      },
    ]);

    const after = await readAgentRowByName(database, "quiz-master");

    expect(after).toEqual(before);
    expect(
      await countRows(
        database,
        "SELECT COUNT(*) AS count FROM agent_deployment_version WHERE agent_id = ?",
        before?.id ?? "",
      ),
    ).toBe(1);
  });

  test("updates a changed manifest, mints a version, and flips the live pointer", async () => {
    const { bindings, database } = await createFixture();

    await deployRepo(bindings, minimalRepoFiles());
    const before = await readAgentRowByName(database, "quiz-master");
    const outcome = await deployRepo(
      bindings,
      minimalRepoFiles({ prompts: { system: "You are the improved quiz master." } }),
    );

    expect(outcome.blocking).toBeUndefined();
    expect(outcome.results).toEqual([
      {
        action: "updated",
        agentId: before?.id,
        name: "quiz-master",
        versionNumber: 2,
      },
    ]);

    const after = await readAgentRowByName(database, "quiz-master");

    expect(after?.prompt).toBe("You are the improved quiz master.");
    expect(after?.status).toBe("published");
    expect(after?.live_deployment_version_id).not.toBe(before?.live_deployment_version_id);

    const liveVersion = await database
      .prepare("SELECT prompt, version_number FROM agent_deployment_version WHERE id = ?")
      .bind(after?.live_deployment_version_id ?? "")
      .first<{ prompt: string; version_number: number }>();

    expect(liveVersion).toEqual({
      prompt: "You are the improved quiz master.",
      version_number: 2,
    });
  });

  test("blocks with native_agent_name_ambiguous when the name matches more than one agent", async () => {
    const { bindings, database } = await createFixture();
    const nowMs = nowMsForTest();
    const duplicateIds = ["01J000000000000000000000D1", "01J000000000000000000000D2"];

    for (const id of duplicateIds) {
      await database
        .app()
        .insert(agentsTable)
        .values({
          configJson: JSON.stringify({
            packageMcpServers: [],
            packageResolution: null,
            packageSkills: [],
          }),
          createdAt: nowMs,
          description: null,
          environmentId: null,
          id,
          kind: "pet",
          model: "gpt-5.4",
          name: "quiz-master",
          ownerId: PUBLIC_API_TEST_IDS.ownerAccount,
          appId: APP_ID,
          prompt: "Duplicate.",
          provider: "openai",
          runtimeId: "openai-runtime",
          status: "draft",
          updatedAt: nowMs,
          visibility: "private",
        })
        .run();
    }

    const outcome = await deployRepo(bindings, minimalRepoFiles());

    expect(outcome.blocking?.code).toBe("native_agent_name_ambiguous");
    expect(outcome.blocking?.message).toContain('"quiz-master"');
    expect(outcome.blocking?.message).toContain("2 existing agents");
    expect(outcome.results).toEqual([{ action: "failed", agentId: null, name: "quiz-master" }]);
    expect(
      await countRows(
        database,
        "SELECT COUNT(*) AS count FROM agent WHERE app_id = ? AND name = ?",
        APP_ID,
        "quiz-master",
      ),
    ).toBe(2);
  });

  test("publish-not-ready becomes native_setup_required and leaves the draft behind", async () => {
    const { bindings, database } = await createFixture();
    const files: Record<string, string> = {
      ".agent/environment/definition.json": `${JSON.stringify(
        {
          expectedName: "Default",
          secretNames: ["QUIZ_API_TOKEN"],
          setupScript: "",
        },
        null,
        2,
      )}\n`,
      ".agent/manifest.json": openaiAgentManifest("quiz-master", {
        environment: { ref: "environment/definition.json" },
      }),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    };

    const outcome = await deployRepo(bindings, files);

    expect(outcome.blocking?.code).toBe("native_setup_required");
    expect(outcome.blocking?.message).toContain('Agent "quiz-master"');
    expect(outcome.blocking?.message).toContain("App settings");
    expect(outcome.blocking?.message).toContain("QUIZ_API_TOKEN");
    expect(outcome.results).toEqual([
      { action: "failed", agentId: expect.any(String), name: "quiz-master" },
    ]);

    const row = await readAgentRowByName(database, "quiz-master");

    expect(row).toMatchObject({ status: "draft" });
    expect(row?.live_deployment_version_id).toBeNull();
    expect(row?.environment_id).toBe(PUBLIC_API_TEST_IDS.environment);
  });

  test("re-deploy adopts a blocked draft by name and publishes once unblocked", async () => {
    const { bindings, database } = await createFixture();

    const blocked = await deployRepo(bindings, {
      ".agent/environment/definition.json": `${JSON.stringify(
        {
          expectedName: "Default",
          secretNames: ["QUIZ_API_TOKEN"],
          setupScript: "",
        },
        null,
        2,
      )}\n`,
      ".agent/manifest.json": openaiAgentManifest("quiz-master", {
        environment: { ref: "environment/definition.json" },
      }),
      ".mosoo.toml": NATIVE_MARKER_TOML,
    });

    expect(blocked.blocking?.code).toBe("native_setup_required");

    const draft = await readAgentRowByName(database, "quiz-master");
    const outcome = await deployRepo(bindings, minimalRepoFiles());

    expect(outcome.blocking).toBeUndefined();
    expect(outcome.results).toEqual([
      {
        action: "updated",
        agentId: draft?.id,
        name: "quiz-master",
        versionNumber: 1,
      },
    ]);

    const row = await readAgentRowByName(database, "quiz-master");

    expect(row).toMatchObject({ id: draft?.id, status: "published" });
    expect(row?.live_deployment_version_id).toBeTruthy();
    expect(
      await countRows(
        database,
        "SELECT COUNT(*) AS count FROM agent WHERE app_id = ? AND name = ?",
        APP_ID,
        "quiz-master",
      ),
    ).toBe(1);
  });

  test("never touches repo-removed agents", async () => {
    const { bindings, database } = await createFixture();
    const preexisting = await database
      .prepare(
        "SELECT id, name, status, updated_at, live_deployment_version_id FROM agent WHERE id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.agent)
      .first<Record<string, unknown>>();

    const outcome = await deployRepo(bindings, minimalRepoFiles());

    expect(outcome.blocking).toBeUndefined();

    const untouched = await database
      .prepare(
        "SELECT id, name, status, updated_at, live_deployment_version_id FROM agent WHERE id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.agent)
      .first<Record<string, unknown>>();

    expect(untouched).toEqual(preexisting);
    expect(
      await countRows(database, "SELECT COUNT(*) AS count FROM agent WHERE app_id = ?", APP_ID),
    ).toBe(2);
  });

  test("repo skills upload once, adopt on re-deploy, and re-version on content change", async () => {
    const { bindings, database } = await createFixture();
    const skillMarkdown = "---\nname: quiz-tips\ndescription: quiz tips skill\n---\n# Quiz Tips\n";
    const repoWithSkill = (markdown: string): Record<string, string> => ({
      ".agent/manifest.json": openaiAgentManifest("quiz-master", {
        skills: [{ name: "quiz-tips", path: "skills/quiz-tips/" }],
      }),
      ".agent/skills/quiz-tips/SKILL.md": markdown,
      ".mosoo.toml": NATIVE_MARKER_TOML,
    });

    const first = await deployRepo(bindings, repoWithSkill(skillMarkdown));

    expect(first.blocking).toBeUndefined();
    expect(first.results[0]?.action).toBe("created");
    expect(
      await countRows(database, "SELECT COUNT(*) AS count FROM skill WHERE app_id = ?", APP_ID),
    ).toBe(1);

    const second = await deployRepo(bindings, repoWithSkill(skillMarkdown));

    expect(second.blocking).toBeUndefined();
    expect(second.results[0]?.action).toBe("unchanged");
    expect(
      await countRows(database, "SELECT COUNT(*) AS count FROM skill WHERE app_id = ?", APP_ID),
    ).toBe(1);

    const third = await deployRepo(
      bindings,
      repoWithSkill(`${skillMarkdown}\nAlways give one extra tip.\n`),
    );

    expect(third.blocking).toBeUndefined();
    expect(third.results[0]).toMatchObject({ action: "updated", versionNumber: 2 });
    expect(
      await countRows(database, "SELECT COUNT(*) AS count FROM skill WHERE app_id = ?", APP_ID),
    ).toBe(1);
  });

  test("provisions every agent of a multi-agent repo, internal ones included", async () => {
    const { bindings, database } = await createFixture();
    const files: Record<string, string> = {
      ".agent/agents/support/manifest.json": openaiAgentManifest("support"),
      ".agent/agents/triage/manifest.json": openaiAgentManifest("triage"),
      ".agent/manifest.json": openaiAgentManifest("concierge"),
      ".mosoo.toml": `spec = "${MOSOO_NATIVE_SPEC}"\n\n[expose]\nagents = ["concierge", "support"]\n`,
    };

    const outcome = await deployRepo(bindings, files);

    expect(outcome.blocking).toBeUndefined();
    expect(outcome.results.map((result) => [result.name, result.action])).toEqual([
      ["concierge", "created"],
      ["support", "created"],
      ["triage", "created"],
    ]);

    for (const name of ["concierge", "support", "triage"]) {
      const row = await readAgentRowByName(database, name);

      expect(row?.status).toBe("published");
      expect(row?.live_deployment_version_id).toBeTruthy();
    }
  });
});
