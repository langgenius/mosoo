import type {
  SkillSummary,
  SkillsShCatalogResult,
  SkillsShCatalogView,
} from "@mosoo/contracts/skill";
import { useQuery } from "@tanstack/react-query";
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
  detail: (skillId: string) => [...skillKeys.details(), skillId] as const,
  details: () => [...skillKeys.all, "detail"] as const,
  list: (projectId: string) => [...skillKeys.lists(), projectId] as const,
  lists: () => [...skillKeys.all, "list"] as const,
  source: (projectId: string, skillId: string) =>
    [...skillKeys.sources(), projectId, skillId] as const,
  sources: () => [...skillKeys.all, "source"] as const,
};

export function useProjectSkillsQuery(projectId: string | null): UseQueryResult<SkillSummary[]> {
  return useQuery({
    enabled: projectId !== null,
    queryFn: async () => (projectId === null ? [] : listProjectSkills(toProjectId(projectId))),
    queryKey: projectId === null ? [...skillKeys.lists(), "missing"] : skillKeys.list(projectId),
  });
}

export function useSkillsShCatalogQuery(input: {
  availableOnly: boolean;
  enabled?: boolean;
  page: number;
  perPage: number;
  query: string;
  view: SkillsShCatalogView;
}): UseQueryResult<SkillsShCatalogResult> {
  return useQuery({
    enabled: input.enabled ?? true,
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
    enabled: enabled && projectId !== null && skillId !== null,
    queryFn: async () =>
      projectId === null || skillId === null
        ? null
        : fetchSkillSource(toProjectId(projectId), toSkillId(skillId)),
    queryKey:
      projectId === null || skillId === null
        ? [...skillKeys.sources(), "missing"]
        : skillKeys.source(projectId, skillId),
  });
}
