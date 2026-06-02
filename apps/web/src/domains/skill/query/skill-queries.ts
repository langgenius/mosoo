import type { SkillSummary } from "@mosoo/contracts/skill";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toOrganizationId, toSkillId } from "@/routes/typed-id";

import { fetchSkillSource, listOrganizationSkills } from "../api/skill-client";

export const skillKeys = {
  all: ["skill"] as const,
  detail: (skillId: string) => [...skillKeys.details(), skillId] as const,
  details: () => [...skillKeys.all, "detail"] as const,
  list: (organizationId: string) => [...skillKeys.lists(), organizationId] as const,
  lists: () => [...skillKeys.all, "list"] as const,
  source: (skillId: string) => [...skillKeys.sources(), skillId] as const,
  sources: () => [...skillKeys.all, "source"] as const,
};

export function useOrganizationSkillsQuery(
  organizationId: string | null,
): UseQueryResult<SkillSummary[]> {
  return useQuery({
    enabled: organizationId !== null,
    queryFn: async () =>
      organizationId === null ? [] : listOrganizationSkills(toOrganizationId(organizationId)),
    queryKey:
      organizationId === null ? [...skillKeys.lists(), "missing"] : skillKeys.list(organizationId),
  });
}

export function useSkillSourceQuery(
  skillId: string | null,
  enabled = true,
): UseQueryResult<string | null> {
  return useQuery({
    enabled: enabled && skillId !== null,
    queryFn: async () => (skillId === null ? null : fetchSkillSource(toSkillId(skillId))),
    queryKey: skillId === null ? [...skillKeys.sources(), "missing"] : skillKeys.source(skillId),
  });
}
