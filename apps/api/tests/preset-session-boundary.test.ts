import { expect, test } from "bun:test";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";
import { createHttpApp } from "../src/adapters/http/create-http-app";
import { updateAgentConfig } from "../src/modules/agents/application/agent-command.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS as IDS,
} from "./helpers/public-api-http-test-fixture";
import { OWNER_VIEWER } from "./public-thread-api-fixtures";

test("a published preset can change harness without mutating its admitted Session or active Run", async () => {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  await database
    .prepare("UPDATE agent SET status = 'published' WHERE id = ?")
    .bind(IDS.agent)
    .run();
  await database
    .prepare(`INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, trigger, status, runtime_id, trace_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'user_prompt', 'running', 'openai-runtime', 'preset-change', 1, 1)`)
    .bind(IDS.run, IDS.ownerSession, IDS.agent, IDS.ownerAccount)
    .run();
  await database
    .prepare("UPDATE session SET status = 'RUNNING', last_run_id = ? WHERE id = ?")
    .bind(IDS.run, IDS.ownerSession)
    .run();
  const sessionBefore = await database
    .prepare("SELECT * FROM session WHERE id = ?")
    .bind(IDS.ownerSession)
    .first();
  const snapshotBefore = await database
    .prepare("SELECT * FROM session_execution_snapshot WHERE session_id = ?")
    .bind(IDS.ownerSession)
    .first();
  const runBefore = await database
    .prepare("SELECT * FROM session_run WHERE id = ?")
    .bind(IDS.run)
    .first();
  const versionsBefore = (
    await database.prepare("SELECT * FROM agent_deployment_version ORDER BY version_number").all()
  ).results;
  const result = await updateAgentConfig(database, OWNER_VIEWER, {
    agentId: IDS.agent,
    projectId: IDS.project,
    name: "Reusable preset",
    description: null,
    runtimeId: "claude-agent-sdk",
    model: "claude-haiku-4-5",
    provider: "anthropic",
    prompt: "Future Session instructions",
    environment: { environmentId: null },
    builtInTools: [],
    providerOptions: {},
    mcpServerIds: [],
    skillIds: [],
  });
  expect(result.runtimeId).toBe("claude-agent-sdk");
  expect(
    await database.prepare("SELECT * FROM session WHERE id = ?").bind(IDS.ownerSession).first(),
  ).toEqual(sessionBefore);
  expect(
    await database
      .prepare("SELECT * FROM session_execution_snapshot WHERE session_id = ?")
      .bind(IDS.ownerSession)
      .first(),
  ).toEqual(snapshotBefore);
  expect(
    await database.prepare("SELECT * FROM session_run WHERE id = ?").bind(IDS.run).first(),
  ).toEqual(runBefore);
  const versionsAfter = (
    await database.prepare("SELECT * FROM agent_deployment_version ORDER BY version_number").all()
  ).results;
  expect(versionsAfter).toHaveLength(versionsBefore.length + 1);
  expect(versionsAfter.slice(0, versionsBefore.length)).toEqual(versionsBefore);
});

test("the console schema exposes Session maintenance and retires Agent-wide operations", () => {
  const fields = createGraphQLSchema().getMutationType()!.getFields();
  for (const name of ["restartDriver", "recreateSandbox", "resetAgentState"])
    expect(fields[name]).toBeUndefined();
  for (const name of ["restartSessionDriver", "recreateSessionSandbox"]) {
    expect(fields[name].args.map((arg) => arg.name).toSorted()).toEqual(["projectId", "sessionId"]);
  }
});

test("the retired shared-Agent Terminal route cannot allocate a machine", async () => {
  const database = await createPublicHttpContractDatabase();
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const response = await createHttpApp().fetch(
    new Request(`https://api.example.com/api/agent/${IDS.agent}/owner-debug-terminal/ws`, {
      headers: { Upgrade: "websocket" },
    }),
    bindings,
    createTestExecutionContext(),
  );
  expect(response.status).toBe(404);
  expect(await database.prepare("SELECT count(*) AS n FROM sandbox").first()).toEqual({ n: 0 });
});
