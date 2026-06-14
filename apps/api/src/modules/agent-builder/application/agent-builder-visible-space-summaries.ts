import type { AgentBuilderVisibleSpaceSummary } from "@mosoo/contracts/agent-builder";
import type { SpaceRole } from "@mosoo/contracts/space";
import type { AppId, SpaceId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listAppSpaces } from "../../spaces/application/space.service";
import { compareByNameThenId, toBindingState, withHash } from "./agent-builder-visible-asset-model";

export interface AgentBuilderVisibleSpaceRecord {
  id: SpaceId;
  name: string;
  role: SpaceRole;
}

export async function listAgentBuilderVisibleSpaceRecords(input: {
  bindings: ApiBindings;
  appId: AppId;
  viewer: AuthenticatedViewer;
}): Promise<AgentBuilderVisibleSpaceRecord[]> {
  return listAppSpaces(input.bindings.DB, input.viewer, input.appId);
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
      }),
    )
    .toSorted((left, right) => compareByNameThenId(left, right));
}
