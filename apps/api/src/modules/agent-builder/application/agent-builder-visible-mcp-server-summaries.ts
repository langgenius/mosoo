import type { AgentBuilderVisibleMcpServerSummary } from "@mosoo/contracts/agent-builder";
import type {
  McpAuthType,
  McpAuthorizationState,
  McpCredentialScope,
  McpCredentialStatus,
  McpServerSource,
} from "@mosoo/contracts/mcp";
import type { McpServerId, OrganizationId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getMcpRegistry } from "../../mcp/application/mcp-registry.service";
import {
  compareByNameThenId,
  readUrlHost,
  toBindingState,
  withHash,
} from "./agent-builder-visible-asset-model";

export interface AgentBuilderVisibleMcpServerRecord {
  authType: McpAuthType;
  authorizationState: McpAuthorizationState;
  credentialScope: McpCredentialScope;
  credentialStatus: McpCredentialStatus;
  description: string | null;
  enabled: boolean;
  id: McpServerId;
  name: string;
  source: McpServerSource;
  updatedAt: string;
  url: string;
}

export interface AgentBuilderVisibleMcpServerRecords {
  organizationShared: readonly AgentBuilderVisibleMcpServerRecord[];
  personal: readonly AgentBuilderVisibleMcpServerRecord[];
}

export function createAgentBuilderVisibleMcpServerSummaries(
  input: {
    boundMcpServerIds: ReadonlySet<McpServerId>;
    bindingRepresented: boolean;
  },
  records: AgentBuilderVisibleMcpServerRecords,
): AgentBuilderVisibleMcpServerSummary[] {
  return [...records.personal, ...records.organizationShared]
    .map((server) =>
      withHash({
        authType: server.authType,
        authorizationState: server.authorizationState,
        bindingState: toBindingState(server.id, input.boundMcpServerIds, input.bindingRepresented),
        credentialScope: server.credentialScope,
        credentialStatus: server.credentialStatus,
        description: server.description,
        enabled: server.enabled,
        id: server.id,
        name: server.name,
        source: server.source,
        updatedAt: server.updatedAt,
        urlHost: readUrlHost(server.url),
      }),
    )
    .toSorted((left, right) => compareByNameThenId(left, right));
}

export async function collectAgentBuilderVisibleMcpServerSummaries(input: {
  bindingRepresented: boolean;
  bindings: ApiBindings;
  boundMcpServerIds: ReadonlySet<McpServerId>;
  organizationId: OrganizationId;
  viewer: AuthenticatedViewer;
}): Promise<AgentBuilderVisibleMcpServerSummary[]> {
  const registry = await getMcpRegistry(input.bindings.DB, input.viewer, input.organizationId);

  return createAgentBuilderVisibleMcpServerSummaries(
    {
      bindingRepresented: input.bindingRepresented,
      boundMcpServerIds: input.boundMcpServerIds,
    },
    registry,
  );
}
