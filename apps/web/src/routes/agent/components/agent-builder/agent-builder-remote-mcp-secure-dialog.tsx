import type { McpServerWithCredential } from "@mosoo/contracts/mcp";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";

import {
  connectMcpBearer,
  createPersonalMcpServer,
  getMcpOAuthFlowState,
  startMcpOAuth,
} from "@/domains/mcp/api/mcp-client";
import { mcpKeys } from "@/domains/mcp/query/mcp-queries";
import { AddMcpDialog } from "@/routes/integrations/mcp/add-mcp-dialog";
import type { McpConnectTargetServer } from "@/routes/integrations/mcp/oauth-connect-dialog";
import { OAuthConnectDialog } from "@/routes/integrations/mcp/oauth-connect-dialog";
import { toMcpOAuthFlowId, toOrganizationId } from "@/routes/typed-id";

export function AgentBuilderRemoteMcpSecureDialog(input: {
  readonly connectServer?: McpConnectTargetServer | null | undefined;
  readonly onConnectServerClose?: (() => void) | undefined;
  readonly onCreated: (server: McpServerWithCredential) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly organizationId: string;
}): ReactElement {
  const queryClient = useQueryClient();
  const [oauthServer, setOauthServer] = useState<McpServerWithCredential | null>(null);
  const organizationId = toOrganizationId(input.organizationId);
  // A credential-connect target can come from the local create flow or be
  // requested externally (Builder direct-created server records).
  const connectTarget: McpConnectTargetServer | null = oauthServer ?? input.connectServer ?? null;

  async function refreshMcpRegistry(): Promise<void> {
    await queryClient.invalidateQueries({
      queryKey: mcpKeys.registry(organizationId),
    });
  }

  async function handleAddMcpSubmit(addInput: {
    readonly authType: "bearer" | "oauth";
    readonly description?: string;
    readonly iconUrl?: string;
    readonly name: string;
    readonly oauthClientId?: string;
    readonly oauthClientSecret?: string;
    readonly url: string;
  }): Promise<void> {
    const created = await createPersonalMcpServer({
      authType: addInput.authType,
      name: addInput.name,
      organizationId,
      url: addInput.url,
      ...(addInput.description && { description: addInput.description }),
      ...(addInput.iconUrl && { iconUrl: addInput.iconUrl }),
      ...(addInput.oauthClientId && { oauthClientId: addInput.oauthClientId }),
      ...(addInput.oauthClientSecret && { oauthClientSecret: addInput.oauthClientSecret }),
    });
    await refreshMcpRegistry();
    input.onCreated(created);
    setOauthServer(created);
  }

  return (
    <>
      <AddMcpDialog
        onOpenChange={input.onOpenChange}
        onSubmit={handleAddMcpSubmit}
        open={input.open}
      />
      <OAuthConnectDialog
        onBearerConnect={async (token) => {
          if (connectTarget === null) {
            return;
          }
          await connectMcpBearer({
            serverId: connectTarget.id,
            token,
          });
        }}
        onConnected={refreshMcpRegistry}
        onOpenChange={(next) => {
          if (!next) {
            setOauthServer(null);
            input.onConnectServerClose?.();
          }
        }}
        onPollOAuthFlow={async (flowId) => getMcpOAuthFlowState(toMcpOAuthFlowId(flowId))}
        onStartOAuth={async () => {
          if (connectTarget === null) {
            throw new Error("MCP server is missing.");
          }

          return startMcpOAuth({
            serverId: connectTarget.id,
          });
        }}
        open={connectTarget !== null}
        server={connectTarget}
      />
    </>
  );
}
