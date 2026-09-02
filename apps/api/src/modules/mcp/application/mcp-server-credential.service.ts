import type { ConnectMcpBearerInput, McpServerWithCredential } from "@mosoo/contracts/mcp";
import type { McpServerId, ProjectId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  getProjectCredentialRow,
  hasProjectCredential,
  revokeCredential,
  writeCredential,
} from "./mcp-credential.repository";
import { toServerWithCredential } from "./mcp-mappers";
import { ensureServerAccess } from "./mcp-server.repository";

export async function connectMcpBearer(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ConnectMcpBearerInput,
): Promise<McpServerWithCredential> {
  const { server } = await ensureServerAccess(bindings.DB, viewer, input.projectId, input.serverId);

  if (server.authType !== "bearer") {
    throw new Error("This MCP server does not use bearer authentication.");
  }

  if (server.credentialScope !== "app") {
    throw new Error("This MCP server is not configured for project credentials.");
  }

  const existing = await getProjectCredentialRow(bindings.DB, server.id);
  const credential = await writeCredential(bindings.DB, bindings, {
    accessToken: input.token,
    authType: "bearer",
    credentialId: existing?.id ?? null,
    scope: "app",
    scopeValues: [],
    server,
    subjectLabel: input.subjectLabel ?? viewer.email ?? null,
  });

  return toServerWithCredential(
    server,
    credential,
    await hasProjectCredential(bindings.DB, server.id),
  );
}

export async function revokeMcpCredential(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  serverId: McpServerId,
): Promise<McpServerWithCredential> {
  const { server } = await ensureServerAccess(database, viewer, projectId, serverId);
  const credential = await getProjectCredentialRow(database, server.id);
  await revokeCredential(database, credential);
  const [nextCredential, hasCredential] = await Promise.all([
    getProjectCredentialRow(database, server.id),
    hasProjectCredential(database, server.id),
  ]);

  return toServerWithCredential(server, nextCredential, hasCredential);
}
