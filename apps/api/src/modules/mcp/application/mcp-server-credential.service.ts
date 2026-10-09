import type { ConnectMcpBearerInput, McpServerWithCredential } from "@mosoo/contracts/mcp";
import type { McpServerId, ProjectId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  getProjectCredentialRow,
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
  const server = await ensureServerAccess(bindings.DB, viewer, input.projectId, input.serverId);

  if (server.authType !== "bearer") {
    throw new Error("This MCP server does not use bearer authentication.");
  }

  const existing = await getProjectCredentialRow(bindings.DB, server.id);
  const credential = await writeCredential(bindings.DB, bindings, {
    accessToken: input.token,
    authType: "bearer",
    credentialId: existing?.id ?? null,
    scopeValues: [],
    server,
    subjectLabel: input.subjectLabel ?? viewer.email ?? null,
  });

  return toServerWithCredential(server, credential);
}

export async function revokeMcpCredential(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  serverId: McpServerId,
): Promise<McpServerWithCredential> {
  const server = await ensureServerAccess(database, viewer, projectId, serverId);
  await revokeCredential(database, await getProjectCredentialRow(database, server.id));

  return toServerWithCredential(server, await getProjectCredentialRow(database, server.id));
}
