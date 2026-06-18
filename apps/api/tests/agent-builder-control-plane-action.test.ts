import { describe, expect, test } from "bun:test";

import { agentBuilderSchema } from "../src/adapters/graphql/schema/agent-builder-schema";
import { executeAgentBuilderControlPlaneAction } from "../src/modules/agent-builder/application/agent-builder-control-plane-action.service";
import {
  createAgentBuilderApiFixture,
  insertAgentBuilderVendorCredential,
} from "./helpers/agent-builder-api-fixture";
import type { AgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";

type ControlPlaneActionInput = Parameters<typeof executeAgentBuilderControlPlaneAction>[2];

const COMPLETE_DRAFT_YAML = [
  "version: 1",
  "kind: cattle",
  "identity:",
  "  name: Slack Support Bot",
  "  description: Triage customer support messages in Slack.",
  "runtime:",
  "  id: claude-agent-sdk",
  "  provider: anthropic",
  "  model: claude-sonnet-4-5",
  "prompt: Triage Slack support messages and write concise replies.",
  "environment:",
  "  environmentId: null",
  "assets:",
  "  skills: []",
  "  mcpServers: []",
  "builder:",
  "  componentDecisions:",
  "    environment: skipped",
].join("\n");
const TOMBSTONE_MCP_SERVER_ID = "01J000000000000000000000M2";
const TOMBSTONE_SKILL_ID = "01J000000000000000000000F2";

async function executeFixtureControlPlaneAction(
  fixture: AgentBuilderApiFixture,
  input: Omit<ControlPlaneActionInput, "appId">,
) {
  return executeAgentBuilderControlPlaneAction(fixture.bindings, fixture.viewer, {
    ...input,
    appId: fixture.ids.appId,
  });
}

async function insertAnthropicVendorCredential(fixture: AgentBuilderApiFixture): Promise<void> {
  await insertAgentBuilderVendorCredential(fixture, {
    name: "Anthropic test",
    vendorId: "anthropic",
  });
}

async function insertPreviewSession(
  fixture: AgentBuilderApiFixture,
  input: {
    readonly agentId?: string;
    readonly archivedAt?: number | null;
    readonly createdAt: number;
    readonly creatorAccountId?: string;
    readonly id: string;
    readonly updatedAt: number;
  },
): Promise<void> {
  await fixture.bindings.DB.prepare(
    `INSERT INTO session (
      agent_id,
      archived_at,
      attributed_user_id,
      created_at,
      creator_account_id,
      id,
      kind,
      last_message_at,
      message_seq_cursor,
      metadata_json,
      model,
      app_id,
      provider,
      renamed,
      runtime_id,
      status,
      title,
      type,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.agentId ?? fixture.ids.agentId,
      input.archivedAt ?? null,
      null,
      input.createdAt,
      input.creatorAccountId ?? fixture.viewer.id,
      input.id,
      "pet",
      input.updatedAt,
      1,
      "{}",
      "claude-sonnet-4-5",
      fixture.ids.appId,
      "anthropic",
      0,
      "claude-agent-sdk",
      "IDLE",
      null,
      "preview",
      input.updatedAt,
    )
    .run();
}

describe("Agent Builder control-plane action execution", () => {
  test("keeps credential material out of the Builder control-plane mutation", () => {
    expect(agentBuilderSchema).toContain("input ExecuteAgentBuilderControlPlaneActionInput");
    expect(agentBuilderSchema).toContain("enum AgentBuilderExecutableActionToolId");
    expect(agentBuilderSchema).toContain("toolId: AgentBuilderExecutableActionToolId!");
    expect(agentBuilderSchema).toContain(
      "createEnvironmentPayload: AgentBuilderCreateEnvironmentPayloadInput",
    );
    expect(agentBuilderSchema).toContain(
      "createRemoteMcpServerPayload: AgentBuilderCreateRemoteMcpServerPayloadInput",
    );
    expect(agentBuilderSchema).not.toContain("enum AgentBuilderControlPlaneToolId");
    expect(agentBuilderSchema).not.toContain("toolId: AgentBuilderControlPlaneToolId!");
    // The Builder may create resource records, but credentials and secret
    // values must stay in the dedicated secure UI flows.
    expect(agentBuilderSchema).not.toContain("oauthClientId");
    expect(agentBuilderSchema).not.toContain("oauthClientSecret");
    expect(agentBuilderSchema).not.toContain("sharedBearerToken");
    expect(agentBuilderSchema).not.toContain("token");
    expect(agentBuilderSchema).not.toContain("envVars");
    expect(agentBuilderSchema).not.toContain("apiKey");
    expect(agentBuilderSchema).not.toContain("setupScript");
  });

  test("creates an Environment directly when the action carries a payload", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      createEnvironmentPayload: {
        description: "Build sandbox for the Slack bot.",
        name: "Slack Bot Environment",
      },
      toolId: "create_environment",
    });

    expect(result).toMatchObject({
      status: "applied",
      toolId: "create_environment",
    });
    expect(result.secureUi).toBeUndefined();
    expect(result.createdEnvironment?.name).toBe("Slack Bot Environment");

    const row = await fixture.bindings.DB.prepare(
      "SELECT app_id, description, name, owner_account_id FROM environment WHERE id = ?",
    )
      .bind(result.createdEnvironment?.id ?? "")
      .first();

    expect(row).toMatchObject({
      app_id: fixture.ids.appId,
      description: "Build sandbox for the Slack bot.",
      name: "Slack Bot Environment",
      owner_account_id: fixture.viewer.id,
    });
  });

  test("creates an MCP server record directly and routes credential connection to secure UI", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      createRemoteMcpServerPayload: {
        authType: "bearer",
        name: "Linear MCP",
        url: "https://mcp.linear.app/mcp",
      },
      toolId: "create_remote_mcp_server",
    });

    expect(result).toMatchObject({
      status: "applied",
      toolId: "create_remote_mcp_server",
    });
    expect(result.createdMcpServer).toMatchObject({
      authType: "bearer",
      name: "Linear MCP",
      url: "https://mcp.linear.app/mcp",
    });
    expect(result.secureUi).toEqual({
      kind: "connect_mcp_credential",
      mcpServerId: result.createdMcpServer?.id,
    });

    const row = await fixture.bindings.DB.prepare(
      "SELECT auth_type, name, app_id, source, url FROM mcp_server WHERE id = ?",
    )
      .bind(result.createdMcpServer?.id ?? "")
      .first();

    expect(row).toMatchObject({
      auth_type: "bearer",
      name: "Linear MCP",
      app_id: fixture.ids.appId,
      source: "app",
      url: "https://mcp.linear.app/mcp",
    });

    const credentialCount = await fixture.bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM mcp_credential WHERE server_id = ?",
    )
      .bind(result.createdMcpServer?.id ?? "")
      .first();

    expect(credentialCount).toMatchObject({ count: 0 });
  });

  test("returns noop when the MCP server payload is rejected", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      createRemoteMcpServerPayload: {
        authType: "bearer",
        name: "Insecure MCP",
        url: "http://mcp.example.com/mcp",
      },
      toolId: "create_remote_mcp_server",
    });

    expect(result.status).toBe("noop");
    expect(result.createdMcpServer).toBeUndefined();
    expect(result.message).toContain("Could not create the MCP server");
  });

  test("rejects unavailable Manifest model selection before applying config", async () => {
    const fixture = await createAgentBuilderApiFixture();

    await expect(
      executeFixtureControlPlaneAction(fixture, {
        agentId: fixture.ids.agentId,
        draftYaml: COMPLETE_DRAFT_YAML,
        toolId: "apply_agent_config",
      }),
    ).rejects.toThrow("Model claude-sonnet-4-5 is not available for runtime claude-agent-sdk.");

    const row = await fixture.bindings.DB.prepare(
      "SELECT kind, model, name, provider, runtime_id FROM agent WHERE id = ?",
    )
      .bind(fixture.ids.agentId)
      .first<{
        kind: string;
        model: string;
        name: string;
        provider: string;
        runtime_id: string;
      }>();

    expect(row).toEqual({
      kind: "pet",
      model: "gpt-5.4",
      name: "Agent Builder Fixture",
      provider: "openai",
      runtime_id: "openai-runtime",
    });
  });

  test("applies the current Manifest through the Agent config service", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await insertAnthropicVendorCredential(fixture);

    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      draftYaml: COMPLETE_DRAFT_YAML,
      toolId: "apply_agent_config",
    });
    const row = await fixture.bindings.DB.prepare(
      "SELECT config_json, kind, model, name, prompt, provider, runtime_id FROM agent WHERE id = ?",
    )
      .bind(fixture.ids.agentId)
      .first<{
        config_json: string;
        kind: string;
        model: string;
        name: string;
        prompt: string;
        provider: string;
        runtime_id: string;
      }>();

    expect(result.status).toBe("applied");
    expect(row).toMatchObject({
      kind: "cattle",
      model: "claude-sonnet-4-5",
      name: "Slack Support Bot",
      prompt: "Triage Slack support messages and write concise replies.",
      provider: "anthropic",
      runtime_id: "claude-agent-sdk",
    });
    expect(JSON.parse(row?.config_json ?? "{}").builder.componentDecisions.environment).toBe(
      "skipped",
    );
  });

  test("keeps tombstone Skill references out of applied Agent config", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await insertAnthropicVendorCredential(fixture);
    const draftYaml = COMPLETE_DRAFT_YAML.replace(
      "  skills: []",
      [
        "  skills:",
        `    - id: ${TOMBSTONE_SKILL_ID}`,
        "      name: Deleted Skill",
        "      state: tombstone",
      ].join("\n"),
    );
    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      draftYaml,
      toolId: "apply_agent_config",
    });
    const skillCount = await fixture.bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM agent_skill WHERE agent_id = ?",
    )
      .bind(fixture.ids.agentId)
      .first<{ count: number }>();

    expect(result.status).toBe("applied");
    expect(skillCount?.count).toBe(0);
  });

  test("keeps tombstone MCP server references out of applied Agent config", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await insertAnthropicVendorCredential(fixture);
    const draftYaml = COMPLETE_DRAFT_YAML.replace(
      "  mcpServers: []",
      [
        "  mcpServers:",
        `    - id: ${TOMBSTONE_MCP_SERVER_ID}`,
        "      name: Deleted MCP",
        "      state: tombstone",
      ].join("\n"),
    );
    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      draftYaml,
      toolId: "apply_agent_config",
    });
    const bindingCount = await fixture.bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM agent_mcp_binding WHERE agent_id = ?",
    )
      .bind(fixture.ids.agentId)
      .first<{ count: number }>();

    expect(result.status).toBe("applied");
    expect(bindingCount?.count).toBe(0);
  });

  test("rejects empty Manifest drafts before executing apply", async () => {
    const fixture = await createAgentBuilderApiFixture();

    await expect(
      executeFixtureControlPlaneAction(fixture, {
        agentId: fixture.ids.agentId,
        draftYaml: "  ",
        toolId: "apply_agent_config",
      }),
    ).rejects.toThrow("apply_agent_config requires the current Agent Manifest draft YAML.");
  });

  test("rejects malformed Manifest drafts before executing apply", async () => {
    const fixture = await createAgentBuilderApiFixture();

    await expect(
      executeFixtureControlPlaneAction(fixture, {
        agentId: fixture.ids.agentId,
        draftYaml: "[]",
        toolId: "apply_agent_config",
      }),
    ).rejects.toThrow(
      "Cannot apply Agent Builder Manifest: Agent Builder Manifest YAML must be an object.",
    );
  });

  test("rejects malformed asset binding objects before executing apply", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const malformedAssetDraftYaml = [
      "version: 1",
      "kind: cattle",
      "identity:",
      "  name: Slack Support Bot",
      "  description: Triage customer support messages in Slack.",
      "runtime:",
      "  id: claude-agent-sdk",
      "  provider: anthropic",
      "  model: claude-sonnet-4-5",
      "prompt: Triage Slack support messages and write concise replies.",
      "assets:",
      "  skills:",
      "    - name: PDF",
    ].join("\n");

    await expect(
      executeFixtureControlPlaneAction(fixture, {
        agentId: fixture.ids.agentId,
        draftYaml: malformedAssetDraftYaml,
        toolId: "apply_agent_config",
      }),
    ).rejects.toThrow(
      "Cannot apply Agent Builder Manifest: assets.skills[0] must be a string ID or object with id.",
    );

    const malformedMcpAssetDraftYaml = [
      "version: 1",
      "kind: cattle",
      "identity:",
      "  name: Slack Support Bot",
      "  description: Triage customer support messages in Slack.",
      "runtime:",
      "  id: claude-agent-sdk",
      "  provider: anthropic",
      "  model: claude-sonnet-4-5",
      "prompt: Triage Slack support messages and write concise replies.",
      "assets:",
      "  mcpServers:",
      "    - serverId: 01J000000000000000000000F1",
    ].join("\n");

    await expect(
      executeFixtureControlPlaneAction(fixture, {
        agentId: fixture.ids.agentId,
        draftYaml: malformedMcpAssetDraftYaml,
        toolId: "apply_agent_config",
      }),
    ).rejects.toThrow(
      "Cannot apply Agent Builder Manifest: assets.mcpServers[0] must be a string ID or object with id.",
    );
  });

  test("rejects malformed assets sections before executing apply", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const malformedAssetsDraftYaml = [
      "version: 1",
      "kind: cattle",
      "identity:",
      "  name: Slack Support Bot",
      "  description: Triage customer support messages in Slack.",
      "runtime:",
      "  id: claude-agent-sdk",
      "  provider: anthropic",
      "  model: claude-sonnet-4-5",
      "prompt: Triage Slack support messages and write concise replies.",
      "assets: []",
    ].join("\n");

    await expect(
      executeFixtureControlPlaneAction(fixture, {
        agentId: fixture.ids.agentId,
        draftYaml: malformedAssetsDraftYaml,
        toolId: "apply_agent_config",
      }),
    ).rejects.toThrow("Cannot apply Agent Builder Manifest: assets must be an object.");
  });

  test("rejects malformed optional Manifest fields before executing apply", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const malformedFieldDraftYaml = [
      "version: 1",
      "kind: cattle",
      "identity:",
      "  name: Slack Support Bot",
      "  description: Triage customer support messages in Slack.",
      "runtime:",
      "  id: claude-agent-sdk",
      "  provider: anthropic",
      "  model: claude-sonnet-4-5",
      "prompt: Triage Slack support messages and write concise replies.",
      "builder:",
      "  componentDecisions:",
      "    environment: banana",
    ].join("\n");

    await expect(
      executeFixtureControlPlaneAction(fixture, {
        agentId: fixture.ids.agentId,
        draftYaml: malformedFieldDraftYaml,
        toolId: "apply_agent_config",
      }),
    ).rejects.toThrow(
      "Cannot apply Agent Builder Manifest: builder.componentDecisions.environment must be one of: bound, created, skipped.",
    );
  });

  test("rejects malformed Skill binding states before executing apply", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const malformedSkillStateDraftYaml = [
      "version: 1",
      "kind: cattle",
      "identity:",
      "  name: Slack Support Bot",
      "  description: Triage customer support messages in Slack.",
      "runtime:",
      "  id: claude-agent-sdk",
      "  provider: anthropic",
      "  model: claude-sonnet-4-5",
      "prompt: Triage Slack support messages and write concise replies.",
      "assets:",
      "  skills:",
      "    - id: 01J000000000000000000000F1",
      "      name: PDF",
      "      state: banana",
    ].join("\n");

    await expect(
      executeFixtureControlPlaneAction(fixture, {
        agentId: fixture.ids.agentId,
        draftYaml: malformedSkillStateDraftYaml,
        toolId: "apply_agent_config",
      }),
    ).rejects.toThrow(
      "Cannot apply Agent Builder Manifest: assets.skills[0].state must be one of: active, tombstone.",
    );
  });

  test("rejects incomplete Manifest drafts before creating the Agent", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const incompleteDraftYaml = [
      "version: 1",
      "kind: cattle",
      "identity:",
      "  description: Triage customer support messages in Slack.",
      "runtime:",
      "  id: claude-agent-sdk",
      "  provider: anthropic",
      "prompt: Triage Slack support messages and write concise replies.",
    ].join("\n");

    await expect(
      executeFixtureControlPlaneAction(fixture, {
        agentId: fixture.ids.agentId,
        draftYaml: incompleteDraftYaml,
        toolId: "create_agent",
      }),
    ).rejects.toThrow("Cannot apply incomplete Agent Builder Manifest: name, model.");
  });

  test("blocks stale Create Agent actions after the Agent leaves draft state", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await fixture.bindings.DB.prepare("UPDATE agent SET name = ?, status = ? WHERE id = ?")
      .bind("Public API Agent", "published", fixture.ids.agentId)
      .run();

    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      draftYaml: COMPLETE_DRAFT_YAML,
      toolId: "create_agent",
    });
    const row = await fixture.bindings.DB.prepare("SELECT name, status FROM agent WHERE id = ?")
      .bind(fixture.ids.agentId)
      .first<{ name: string; status: string }>();

    expect(result).toMatchObject({
      message: "Create Agent is only available while this Agent is still a draft.",
      status: "noop",
      toolId: "create_agent",
    });
    expect(row).toEqual({
      name: "Public API Agent",
      status: "published",
    });
  });

  test("marks Preview opened without creating a preview Session", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      toolId: "open_preview",
    });
    const thread = await fixture.bindings.DB.prepare(
      "SELECT preview_opened_at FROM agent_builder_thread WHERE agent_id = ?",
    )
      .bind(fixture.ids.agentId)
      .first<{ preview_opened_at: number | null }>();
    const sessionCount = await fixture.bindings.DB.prepare(
      "SELECT COUNT(*) AS count FROM session WHERE agent_id = ? AND type = 'preview'",
    )
      .bind(fixture.ids.agentId)
      .first<{ count: number }>();

    expect(result).toMatchObject({
      status: "applied",
      toolId: "open_preview",
    });
    expect(thread?.preview_opened_at).toBeNumber();
    expect(sessionCount?.count).toBe(0);
  });

  test("deletes all visible preview Sessions for the current Agent", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const targetSessionId = "01J00000000000000000000101";
    const olderSessionId = "01J00000000000000000000100";
    const otherAgentSessionId = "01J00000000000000000000102";
    const archivedSessionId = "01J00000000000000000000103";
    const nonParticipantSessionId = "01J00000000000000000000104";

    await insertPreviewSession(fixture, {
      createdAt: 10,
      id: olderSessionId,
      updatedAt: 10,
    });
    await insertPreviewSession(fixture, {
      createdAt: 20,
      id: targetSessionId,
      updatedAt: 20,
    });
    await insertPreviewSession(fixture, {
      agentId: "01J00000000000000000000999",
      createdAt: 30,
      id: otherAgentSessionId,
      updatedAt: 30,
    });
    await insertPreviewSession(fixture, {
      archivedAt: 40,
      createdAt: 40,
      id: archivedSessionId,
      updatedAt: 40,
    });
    await insertPreviewSession(fixture, {
      createdAt: 50,
      creatorAccountId: "01J00000000000000000000998",
      id: nonParticipantSessionId,
      updatedAt: 50,
    });

    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      toolId: "reset_preview_session",
    });
    const remainingRows = await fixture.bindings.DB.prepare(
      "SELECT id FROM session ORDER BY id",
    ).all<{ id: string }>();

    expect(result).toMatchObject({
      sessionId: targetSessionId,
      status: "applied",
      toolId: "reset_preview_session",
    });
    expect(remainingRows.results.map((row) => row.id)).toEqual([
      otherAgentSessionId,
      archivedSessionId,
      nonParticipantSessionId,
    ]);
  });

  test("routes missing Environment creation payloads to secure UI", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      toolId: "create_environment",
    });

    expect(result).toMatchObject({
      secureUi: { kind: "create_environment" },
      status: "needs_secure_ui",
      toolId: "create_environment",
    });
    expect(result.message).toContain("Environment creation UI");
  });

  test("routes missing remote MCP server creation payloads to secure UI", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const result = await executeFixtureControlPlaneAction(fixture, {
      agentId: fixture.ids.agentId,
      toolId: "create_remote_mcp_server",
    });

    expect(result).toMatchObject({
      secureUi: { kind: "create_remote_mcp_server" },
      status: "needs_secure_ui",
      toolId: "create_remote_mcp_server",
    });
    expect(result.message).toContain("MCP server creation UI");
  });
});
