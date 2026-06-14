import type { AgentBuilderVisibleSkillSummary } from "@mosoo/contracts/agent-builder";
import type { SkillSourceKind } from "@mosoo/contracts/skill";
import type { AppId, SkillId, SkillSnapshotId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listAppSkills } from "../../skills/application/skill-query.service";
import { compareByNameThenId, toBindingState, withHash } from "./agent-builder-visible-asset-model";

export interface AgentBuilderVisibleSkillRecord {
  description: string;
  id: SkillId;
  name: string;
  ownerName: string;
  snapshotId: SkillSnapshotId;
  sourceKind: SkillSourceKind;
  updatedAt: string;
}

export function createAgentBuilderVisibleSkillSummaries(
  input: {
    boundSkillIds: ReadonlySet<SkillId>;
  },
  skills: readonly AgentBuilderVisibleSkillRecord[],
): AgentBuilderVisibleSkillSummary[] {
  return skills
    .map((skill) =>
      withHash({
        bindingState: toBindingState(skill.id, input.boundSkillIds),
        description: skill.description,
        id: skill.id,
        name: skill.name,
        ownerName: skill.ownerName,
        snapshotId: skill.snapshotId,
        sourceKind: skill.sourceKind,
        updatedAt: skill.updatedAt,
      }),
    )
    .toSorted((left, right) => compareByNameThenId(left, right));
}

export async function collectAgentBuilderVisibleSkillSummaries(input: {
  bindings: ApiBindings;
  boundSkillIds: ReadonlySet<SkillId>;
  appId: AppId;
  viewer: AuthenticatedViewer;
}): Promise<AgentBuilderVisibleSkillSummary[]> {
  const skills = await listAppSkills(input.bindings.DB, input.viewer, input.appId);

  return createAgentBuilderVisibleSkillSummaries({ boundSkillIds: input.boundSkillIds }, skills);
}
