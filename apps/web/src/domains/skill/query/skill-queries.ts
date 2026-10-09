import type {
  SkillSummary,
  SkillsShCatalogResult,
  SkillsShCatalogView,
} from "@mosoo/contracts/skill";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toProjectId, toSkillId } from "@/routes/typed-id";

import { fetchSkillSource, listProjectSkills, listSkillsShCatalog } from "../api/skill-client";

export const skillKeys = {
  all: ["skill"] as const,
  catalog: (
    view: SkillsShCatalogView,
    query: string,
    page: number,
    perPage: number,
    availableOnly: boolean,
  ) => [...skillKeys.catalogs(), view, query, page, perPage, availableOnly] as const,
  catalogs: () => [...skillKeys.all, "skills-sh-catalog"] as const,
  list: (projectId: string | null) => [...skillKeys.lists(), projectId] as const,
  lists: () => [...skillKeys.all, "list"] as const,
  source: (projectId: string | null, skillId: string | null) =>
    [...skillKeys.sources(), projectId, skillId] as const,
  sources: () => [...skillKeys.all, "source"] as const,
};

export function useProjectSkillsQuery(projectId: string | null): UseQueryResult<SkillSummary[]> {
  return useQuery({
    queryFn: projectId === null ? skipToken : async () => listProjectSkills(toProjectId(projectId)),
    queryKey: skillKeys.list(projectId),
  });
}

export function useSkillsShCatalogQuery(input: {
  availableOnly: boolean;
  page: number;
  perPage: number;
  query: string;
  view: SkillsShCatalogView;
}): UseQueryResult<SkillsShCatalogResult> {
  return useQuery({
    queryFn: async () =>
      listSkillsShCatalog({
        availableOnly: input.availableOnly,
        page: input.page,
        perPage: input.perPage,
        query: input.query,
        view: input.view,
      }),
    queryKey: skillKeys.catalog(
      input.view,
      input.query,
      input.page,
      input.perPage,
      input.availableOnly,
    ),
    staleTime: 60_000,
  });
}

export function useSkillSourceQuery(
  projectId: string | null,
  skillId: string | null,
  enabled = true,
): UseQueryResult<string | null> {
  return useQuery({
    queryFn:
      !enabled || projectId === null || skillId === null
        ? skipToken
        : async () => fetchSkillSource(toProjectId(projectId), toSkillId(skillId)),
    queryKey: skillKeys.source(projectId, skillId),
  });
}
