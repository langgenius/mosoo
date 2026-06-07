import type { AgentBuilderVisibleEnvironmentSummary } from "@mosoo/contracts/agent-builder";
import type {
  EnvironmentNetworkPolicy,
  EnvironmentPackageManager,
} from "@mosoo/contracts/environment";
import type { EnvironmentId, OrganizationId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listOrganizationEnvironments } from "../../environments/application/environment-queries";
import {
  compareByNameThenId,
  normalizeUnique,
  withHash,
} from "./agent-builder-visible-asset-model";

export interface AgentBuilderVisibleEnvironmentRecord {
  allowMcpServers: boolean;
  allowPackageManagers: boolean;
  description: string;
  envVars: readonly {
    key: string;
  }[];
  id: EnvironmentId;
  isBuiltIn: boolean;
  isDefault: boolean;
  name: string;
  networkPolicy: EnvironmentNetworkPolicy;
  packages: readonly {
    manager: EnvironmentPackageManager;
  }[];
  setupScript: string;
  updatedAt: string;
}

export function createAgentBuilderVisibleEnvironmentSummaries(
  input: {
    environmentId: EnvironmentId | null;
  },
  environments: readonly AgentBuilderVisibleEnvironmentRecord[],
): AgentBuilderVisibleEnvironmentSummary[] {
  return environments
    .map((environment) =>
      withHash({
        allowMcpServers: environment.allowMcpServers,
        allowPackageManagers: environment.allowPackageManagers,
        bindingState:
          input.environmentId !== null && input.environmentId === environment.id
            ? "bound"
            : "not_bound",
        description: environment.description,
        envVarKeys: environment.envVars.map((envVar) => envVar.key).toSorted(),
        id: environment.id,
        isBuiltIn: environment.isBuiltIn,
        isDefault: environment.isDefault,
        name: environment.name,
        networkPolicy: environment.networkPolicy,
        packageManagers: normalizeUnique(
          environment.packages.map((packageSpec) => packageSpec.manager),
        ),
        setupScriptConfigured: environment.setupScript.trim().length > 0,
        updatedAt: environment.updatedAt,
      }),
    )
    .toSorted((left, right) => compareByNameThenId(left, right));
}

export async function collectAgentBuilderVisibleEnvironmentSummaries(input: {
  bindings: ApiBindings;
  environmentId: EnvironmentId | null;
  organizationId: OrganizationId;
  viewer: AuthenticatedViewer;
}): Promise<AgentBuilderVisibleEnvironmentSummary[]> {
  const environments = await listOrganizationEnvironments(
    input.bindings,
    input.viewer,
    input.organizationId,
  );

  return createAgentBuilderVisibleEnvironmentSummaries(
    { environmentId: input.environmentId },
    environments,
  );
}
