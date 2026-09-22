import { expect, test } from "bun:test";

import {
  updateAgentConfig,
  publishAgent,
} from "../src/modules/agents/application/agent-command.service";
import { createDraftAgent } from "../src/modules/agents/application/agent-package-draft.service";
import { getAgentEditorState } from "../src/modules/agents/application/agent-query.service";
import { computeAgentReadiness } from "../src/modules/agents/application/agent-readiness.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS as ids,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
} from "./helpers/public-api-http-test-fixture";

const viewer: AuthenticatedViewer = {
  id: ids.ownerAccount,
  email: "owner@example.com",
  emailVerified: true,
  imageUrl: null,
  name: "Owner",
};
const restricted = [{ name: "bash" as const, enabled: false }];

test("readiness exposes unsupported restrictions before provider probing", async () => {
  const db = await createPublicHttpContractDatabase();
  const readiness = await computeAgentReadiness(db, ids.ownerAccount, {
    agentId: ids.agent,
    bindings: createPublicHttpTestBindings(db) as ApiBindings,
    builtInTools: restricted,
    environment: { environmentId: ids.environment },
    kind: "cattle",
    model: "gpt-5.6-luna",
    projectId: ids.project,
    provider: "openai",
    runtimeId: "openai-runtime",
  });
  expect(readiness).toMatchObject({
    ready: false,
    issues: [{ code: "agent.runtime.tool_restrictions_unsupported", severity: "error" }],
  });
  expect(readiness.issues[0]?.message).toContain("does not support disabling");
});

test("editor readiness retains and explains legacy restrictions", async () => {
  const db = await createPublicHttpContractDatabase();
  await db
    .prepare("UPDATE agent SET config_json = ? WHERE id = ?")
    .bind(
      JSON.stringify({
        builtInTools: restricted,
        packageMcpServers: [],
        packageSkills: [],
        packageResolution: null,
      }),
      ids.agent,
    )
    .run();
  const state = await getAgentEditorState(db, viewer, {
    agentId: ids.agent,
    projectId: ids.project,
  });
  expect(state.builtInTools).toContainEqual(restricted[0]);
  expect(state.readiness).toMatchObject({
    ready: false,
    issues: [{ code: "agent.runtime.tool_restrictions_unsupported" }],
  });
});
test("API rejects unsupported tool restrictions before changing stored config or deployment versions", async () => {
  const db = await createPublicHttpContractDatabase();
  const before = await db
    .prepare("SELECT config_json, live_deployment_version_id FROM agent WHERE id = ?")
    .bind(ids.agent)
    .first();
  await expect(
    updateAgentConfig(db, viewer, {
      agentId: ids.agent,
      projectId: ids.project,
      kind: "pet",
      runtimeId: "openai-runtime",
      provider: "openai",
      model: "gpt-5.4",
      name: "Public API Agent",
      prompt: "Help",
      description: null,
      environment: { environmentId: ids.environment },
      mcpServerIds: [],
      skillIds: [],
      builtInTools: restricted,
    }),
  ).rejects.toThrow("does not support disabling");
  expect(
    await db
      .prepare("SELECT config_json, live_deployment_version_id FROM agent WHERE id = ?")
      .bind(ids.agent)
      .first(),
  ).toEqual(before);
});

test("publishing a legacy incompatible configuration fails before creating a version", async () => {
  const db = await createPublicHttpContractDatabase();
  await db
    .prepare("UPDATE agent SET config_json = ? WHERE id = ?")
    .bind(
      JSON.stringify({
        builtInTools: restricted,
        packageMcpServers: [],
        packageSkills: [],
        packageResolution: null,
      }),
      ids.agent,
    )
    .run();
  const before = await db
    .prepare("SELECT COUNT(*) AS count FROM agent_deployment_version WHERE agent_id = ?")
    .bind(ids.agent)
    .first();
  await expect(
    publishAgent(createPublicHttpTestBindings(db) as ApiBindings, viewer, {
      agentId: ids.agent,
      projectId: ids.project,
    }),
  ).rejects.toThrow("does not support disabling");
  expect(
    await db
      .prepare("SELECT COUNT(*) AS count FROM agent_deployment_version WHERE agent_id = ?")
      .bind(ids.agent)
      .first(),
  ).toEqual(before);
});

test("package draft admission rejects restrictions before inserting an Agent", async () => {
  const db = await createPublicHttpContractDatabase();
  const before = await db.prepare("SELECT COUNT(*) AS count FROM agent").first();
  await expect(
    createDraftAgent(db, {
      agentName: "Invalid package",
      builtInTools: restricted,
      description: null,
      environmentId: ids.environment,
      kind: "pet",
      model: "gpt-5.4",
      ownerId: ids.ownerAccount,
      packageMcpServers: [],
      packageResolution: null,
      packageSkills: [],
      prompt: "Help",
      provider: "openai",
      providerOptions: {},
      projectId: ids.project,
      runtimeId: "openai-runtime",
      skillIds: [],
    }),
  ).rejects.toThrow("does not support disabling");
  expect(await db.prepare("SELECT COUNT(*) AS count FROM agent").first()).toEqual(before);
});
