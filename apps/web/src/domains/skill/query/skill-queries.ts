import type {
  SkillSummary,
  SkillsShCatalogResult,
  SkillsShCatalogView,
} from "@mosoo/contracts/skill";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toAppId, toSkillId } from "@/routes/typed-id";

import { fetchSkillSource, listAppSkills, listSkillsShCatalog } from "../api/skill-client";

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
  list: (appId: string) => [...skillKeys.lists(), appId] as const,
  lists: () => [...skillKeys.all, "list"] as const,
  source: (appId: string, skillId: string) => [...skillKeys.sources(), appId, skillId] as const,
  sources: () => [...skillKeys.all, "source"] as const,
};

export function useAppSkillsQuery(appId: string | null): UseQueryResult<SkillSummary[]> {
  return useQuery({
    enabled: appId !== null,
    queryFn: async () => (appId === null ? [] : listAppSkills(toAppId(appId))),
    queryKey: appId === null ? [...skillKeys.lists(), "missing"] : skillKeys.list(appId),
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
  appId: string | null,
  skillId: string | null,
  enabled = true,
): UseQueryResult<string | null> {
  return useQuery({
    enabled: enabled && appId !== null && skillId !== null,
    queryFn: async () =>
      appId === null || skillId === null
        ? null
        : fetchSkillSource(toAppId(appId), toSkillId(skillId)),
    queryKey:
      appId === null || skillId === null
        ? [...skillKeys.sources(), "missing"]
        : skillKeys.source(appId, skillId),
  });
}
