import type { AgentBuilderVisibleSpaceSummary } from "@mosoo/contracts/agent-builder";
import type { SpaceRole, SpaceVisibility } from "@mosoo/contracts/space";
import type { OrganizationId, SpaceId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listVisibleSpaces } from "../../spaces/application/space.service";
import { compareByNameThenId, toBindingState, withHash } from "./agent-builder-visible-asset-model";

export interface AgentBuilderVisibleSpaceRecord {
  id: SpaceId;
  name: string;
  role: SpaceRole;
  visibility: SpaceVisibility;
}

export async function listAgentBuilderVisibleSpaceRecords(input: {
  bindings: ApiBindings;
  organizationId: OrganizationId;
  viewer: AuthenticatedViewer;
}): Promise<AgentBuilderVisibleSpaceRecord[]> {
  return listVisibleSpaces(input.bindings.DB, input.viewer, input.organizationId);
}

export function createAgentBuilderVisibleSpaceSummaries(
  input: {
    boundSpaceIds: ReadonlySet<SpaceId>;
  },
  spaces: readonly AgentBuilderVisibleSpaceRecord[],
): AgentBuilderVisibleSpaceSummary[] {
  return spaces
    .map((space) =>
      withHash({
        bindingState: toBindingState(space.id, input.boundSpaceIds),
        id: space.id,
        name: space.name,
        role: space.role,
        visibility: space.visibility,
      }),
    )
    .toSorted((left, right) => compareByNameThenId(left, right));
}
