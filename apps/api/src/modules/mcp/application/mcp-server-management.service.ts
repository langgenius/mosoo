import type {
  CreateProjectMcpServerInput,
  McpServerWithCredential,
  UpdateProjectMcpServerInput,
} from "@mosoo/contracts/mcp";
import { agentMcpBindingsTable, mcpServersTable } from "@mosoo/db";
import { ignorePromiseRejection } from "@mosoo/effects";
import { createPlatformId } from "@mosoo/id";
import type { McpServerId, ProjectId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { deleteSecret, storeSecret } from "../../vault/application/vault-secret-store";
import {
  deleteCredentialArtifactsBatch,
  getProjectCredentialRow,
  listCredentialRowsByServerId,
  revokeCredential,
} from "./mcp-credential.repository";
import { parseHttpsUrl, toServerWithCredential } from "./mcp-mappers";
import {
  destroyOAuthFlowArtifactsBatch,
  listOAuthFlowRowsByServerId,
} from "./mcp-oauth-flow.repository";
import { MCP_OAUTH_CLIENT_SECRET_KIND } from "./mcp-oauth.constants";
import { ensureServerAccess, getServerRow } from "./mcp-server.repository";
export async function createProjectMcpServer(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateProjectMcpServerInput,
): Promise<McpServerWithCredential> {
  await ensureProjectOwnership(bindings.DB, viewer.id, input.projectId);
  const now = currentTimestampMs();
  const serverId = createPlatformId<McpServerId>();
  const byoClientSecretSecretId =
    input.authType === "oauth" &&
    input.oauthClientSecret !== null &&
    input.oauthClientSecret !== undefined
      ? await storeSecret(bindings.DB, bindings, {
          kind: MCP_OAUTH_CLIENT_SECRET_KIND,
          value: input.oauthClientSecret,
        })
      : null;

  try {
    await getAppDatabase(bindings.DB)
      .insert(mcpServersTable)
      .values({
        authType: input.authType,
        byoClientId: input.oauthClientId ?? null,
        byoClientSecretSecretId,
        createdAt: now,
        credentialScope: "app",
        description: input.description ?? null,
        enabled: true,
        iconUrl: input.iconUrl ?? null,
        id: serverId,
        name: input.name,
        ownerId: viewer.id,
        projectId: input.projectId,
        source: "app",
        updatedAt: now,
        url: parseHttpsUrl(input.url),
      })
      .run();
  } catch (error) {
    await deleteSecret(bindings.DB, byoClientSecretSecretId).catch(ignorePromiseRejection);
    throw error;
  }

  return toServerWithCredential(await getServerRow(bindings.DB, serverId), null);
}

export async function updateProjectMcpServer(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateProjectMcpServerInput,
): Promise<McpServerWithCredential> {
  const existing = await ensureServerAccess(database, viewer, input.projectId, input.serverId);
  const nextUrl = parseHttpsUrl(input.url);

  // A stored credential is bound to the previous endpoint, so a URL change revokes it.
  if (nextUrl !== existing.url) {
    await revokeCredential(database, await getProjectCredentialRow(database, existing.id));
  }

  await getAppDatabase(database)
    .update(mcpServersTable)
    .set({
      description: input.description ?? null,
      iconUrl: input.iconUrl ?? null,
      name: input.name,
      updatedAt: currentTimestampMs(),
      url: nextUrl,
    })
    .where(eq(mcpServersTable.id, input.serverId))
    .run();

  return toServerWithCredential(
    await getServerRow(database, input.serverId),
    await getProjectCredentialRow(database, input.serverId),
  );
}

export async function setMcpServerEnabled(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  serverId: McpServerId,
  enabled: boolean,
): Promise<McpServerWithCredential> {
  await ensureServerAccess(database, viewer, projectId, serverId);
  await getAppDatabase(database)
    .update(mcpServersTable)
    .set({ enabled, updatedAt: currentTimestampMs() })
    .where(eq(mcpServersTable.id, serverId))
    .run();

  return toServerWithCredential(
    await getServerRow(database, serverId),
    await getProjectCredentialRow(database, serverId),
  );
}

export async function deleteMcpServer(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  serverId: McpServerId,
): Promise<void> {
  const server = await ensureServerAccess(database, viewer, projectId, serverId);
  const [credentialRows, oauthFlowRows] = await Promise.all([
    listCredentialRowsByServerId(database, serverId),
    listOAuthFlowRowsByServerId(database, serverId),
  ]);

  await deleteCredentialArtifactsBatch(database, credentialRows);
  await destroyOAuthFlowArtifactsBatch(database, oauthFlowRows);
  await getAppDatabase(database)
    .delete(agentMcpBindingsTable)
    .where(eq(agentMcpBindingsTable.serverId, serverId))
    .run();
  // The server row is the BYO secret's only reference, so the secret goes first.
  await deleteSecret(database, server.byoClientSecretSecretId);
  await getAppDatabase(database)
    .delete(mcpServersTable)
    .where(eq(mcpServersTable.id, serverId))
    .run();
}
