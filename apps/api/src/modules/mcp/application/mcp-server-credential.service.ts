import type {
  ConnectMcpBearerInput,
  McpServerWithCredential,
  SetOrganizationSharedMcpBearerInput,
} from "@mosoo/contracts/mcp";
import type { McpServerId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  getSharedCredentialRow,
  getUserCredentialRow,
  hasSharedCredential,
  revokeCredential,
  writeCredential,
} from "./mcp-credential.repository";
import { toServerWithCredential } from "./mcp-mappers";
import { readAccountId } from "./mcp-platform-ids";
import { ensureServerAccess, ensureServerManageAccess } from "./mcp-server.repository";

export async function connectMcpBearer(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ConnectMcpBearerInput,
): Promise<McpServerWithCredential> {
  const viewerId = readAccountId(viewer.id);
  const { server } = await ensureServerAccess(bindings.DB, viewer, input.serverId);

  if (server.authType !== "bearer") {
    throw new Error("This MCP server does not use bearer authentication.");
  }

  if (server.credentialScope !== "user") {
    throw new Error("This MCP server is not configured for user credentials.");
  }

  const existing = await getUserCredentialRow(bindings.DB, server.id, viewerId);
  const credential = await writeCredential(bindings.DB, bindings, {
    accessToken: input.token,
    authType: "bearer",
    credentialId: existing?.id ?? null,
    scope: "user",
    scopeValues: [],
    server,
    subjectLabel: input.subjectLabel ?? viewer.email ?? null,
    userId: viewerId,
  });

  return toServerWithCredential(
    server,
    credential,
    await hasSharedCredential(bindings.DB, server.id),
  );
}

export async function revokeMcpUserCredential(
  database: D1Database,
  viewer: AuthenticatedViewer,
  serverId: McpServerId,
): Promise<McpServerWithCredential> {
  const viewerId = readAccountId(viewer.id);
  const { server } = await ensureServerAccess(database, viewer, serverId);
  const credential = await getUserCredentialRow(database, server.id, viewerId);
  await revokeCredential(database, credential);
  const [nextCredential, shared] = await Promise.all([
    getUserCredentialRow(database, server.id, viewerId),
    hasSharedCredential(database, server.id),
  ]);

  return toServerWithCredential(server, nextCredential, shared);
}

export async function setOrganizationSharedBearer(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SetOrganizationSharedMcpBearerInput,
): Promise<McpServerWithCredential> {
  const { server } = await ensureServerManageAccess(bindings.DB, viewer, input.serverId);

  if (server.authType !== "bearer" || server.credentialScope !== "organization_shared") {
    throw new Error(
      "This MCP server is not configured for organization shared bearer credentials.",
    );
  }

  const existing = await getSharedCredentialRow(bindings.DB, server.id);
  const credential = await writeCredential(bindings.DB, bindings, {
    accessToken: input.token,
    authType: "bearer",
    credentialId: existing?.id ?? null,
    scope: "organization_shared",
    scopeValues: [],
    server,
    subjectLabel: input.subjectLabel ?? null,
  });

  return toServerWithCredential(server, credential, true);
}

export async function clearOrganizationSharedCredential(
  database: D1Database,
  viewer: AuthenticatedViewer,
  serverId: McpServerId,
): Promise<McpServerWithCredential> {
  const { server } = await ensureServerManageAccess(database, viewer, serverId);

  const credential = await getSharedCredentialRow(database, server.id);
  await revokeCredential(database, credential);

  return toServerWithCredential(
    server,
    await getSharedCredentialRow(database, server.id),
    await hasSharedCredential(database, server.id),
  );
}
