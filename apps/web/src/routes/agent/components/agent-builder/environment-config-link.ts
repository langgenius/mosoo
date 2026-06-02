import type { AgentBuilderDraftPatchChange } from "@mosoo/contracts/agent-builder";

export interface AgentBuilderEnvironmentConfigLink {
  readonly environmentId: string;
  readonly environmentName: string | null;
  readonly href: string;
}

export function getEnvironmentConfigLink(
  draftPatch: AgentBuilderDraftPatchChange,
): AgentBuilderEnvironmentConfigLink | null {
  if (draftPatch.fieldPath !== "environmentId" || typeof draftPatch.value !== "string") {
    return null;
  }

  const environmentId = draftPatch.value.trim();

  if (environmentId.length === 0) {
    return null;
  }

  const environmentReference = draftPatch.resolvedReferences?.find(
    (reference) => reference.targetType === "environment" && reference.id === environmentId,
  );

  return {
    environmentId,
    environmentName: environmentReference?.name ?? null,
    href: `/environment/${environmentId}`,
  };
}
