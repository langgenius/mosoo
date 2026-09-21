import { expect, test } from "bun:test";

import { mcpCredentialsTable, mcpServersTable, projectsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { CredentialId, McpServerId, ProjectId } from "@mosoo/id";

import { resolveRuntimeMcpServersForSnapshot } from "../src/modules/mcp/application/mcp-runtime.service";
import { getAppDatabase } from "../src/platform/db/drizzle";
import {
  createPublicHttpContractDatabase,
  PUBLIC_API_TEST_IDS as IDS,
} from "./helpers/public-api-http-test-fixture";

test("frozen MCP references use Project authority without a mutable Agent", async () => {
  const database = await createPublicHttpContractDatabase();
  const db = getAppDatabase(database);
  const serverId = createPlatformId<McpServerId>();
  const credentialId = createPlatformId<CredentialId>();
  await db
    .insert(mcpServersTable)
    .values({
      id: serverId,
      authType: "bearer",
      credentialScope: "app",
      createdAt: 1,
      enabled: true,
      name: "Snapshot server",
      ownerId: IDS.ownerAccount,
      projectId: IDS.project,
      source: "app",
      updatedAt: 1,
      url: "https://mcp.example.test",
    })
    .run();
  await db
    .insert(mcpCredentialsTable)
    .values({
      id: credentialId,
      authType: "bearer",
      createdAt: 1,
      projectId: IDS.project,
      scope: "app",
      secretId: "fixture-reference-only",
      serverId,
      status: "active",
      updatedAt: 1,
    })
    .run();
  await database.prepare("DELETE FROM agent WHERE id = ?").bind(IDS.agent).run();
  const input = {
    agentId: IDS.agent,
    bindings: [
      {
        agentCredentialId: null,
        credentialMode: "runtime_resolved" as const,
        enabled: true,
        serverId,
        sortOrder: 0,
      },
    ],
    callerUserId: IDS.ownerAccount,
    executionOwnerUserId: IDS.ownerAccount,
    projectId: IDS.project,
  };
  const resolved = await resolveRuntimeMcpServersForSnapshot({ DB: database }, input);
  expect(resolved).toMatchObject([
    { authorizationState: "active", credentialId, projectId: IDS.project, serverId },
  ]);
  await expect(
    resolveRuntimeMcpServersForSnapshot(
      { DB: database },
      { ...input, callerUserId: IDS.outsiderAccount },
    ),
  ).rejects.toThrow("permission");
  await expect(
    resolveRuntimeMcpServersForSnapshot(
      { DB: database },
      { ...input, executionOwnerUserId: IDS.outsiderAccount },
    ),
  ).rejects.toThrow("Project owner");

  const otherProjectId = createPlatformId<ProjectId>();
  await db
    .insert(projectsTable)
    .values({
      id: otherProjectId,
      name: "Same owner, different Project",
      organizationId: IDS.organization,
      ownerAccountId: IDS.ownerAccount,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  await expect(
    resolveRuntimeMcpServersForSnapshot({ DB: database }, { ...input, projectId: otherProjectId }),
  ).rejects.toThrow("not available in this project");
});
