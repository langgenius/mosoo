import type { SkillDetail, SkillInspectResult, SkillSummary } from "@mosoo/contracts/skill";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAppSession } from "../../../app/session-provider";
import {
  createSkillFork as createSkillForkRemote,
  deleteOwnedSkill as deleteOwnedSkillRemote,
  fetchSkillSource,
  getSkillDetail as getSkillDetailRemote,
  installSkillsShSkill as installSkillsShSkillRemote,
  inspectSkillUpload,
  publishSkillPackage,
} from "../../../domains/skill/api/skill-client";
import { skillKeys, useProjectSkillsQuery } from "../../../domains/skill/query/skill-queries";
import { useTranslation } from "../../../shared/i18n";
import { isTruthy } from "../../../shared/lib/truthiness";
import { toProjectId, toSkillId } from "../../typed-id";
export function useSkillRegistry() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { activeProjectId, projectsLoading } = useAppSession();
  const projectId = activeProjectId;
  const skillsQuery = useProjectSkillsQuery(projectId);
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data]);

  const refresh = useCallback(async () => {
    if (!isTruthy(projectId)) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: skillKeys.list(toProjectId(projectId)),
    });
  }, [queryClient, projectId]);

  const personal = skills;

  const getSkill = useCallback(
    (skillId: string): SkillSummary | undefined => skills.find((skill) => skill.id === skillId),
    [skills],
  );

  const getSkillDetail = useCallback(
    async (skillId: string): Promise<SkillDetail> => {
      if (!isTruthy(projectId)) {
        throw new Error(t("skills.projectRequired"));
      }

      return getSkillDetailRemote(toProjectId(projectId), toSkillId(skillId));
    },
    [projectId, t],
  );

  const getSkillSource = useCallback(
    async (skillId: string): Promise<string> => {
      if (!isTruthy(projectId)) {
        throw new Error(t("skills.projectRequired"));
      }

      return fetchSkillSource(toProjectId(projectId), toSkillId(skillId));
    },
    [projectId, t],
  );

  const publishFromFile = useCallback(
    async (file: File): Promise<SkillSummary | null> => {
      if (!isTruthy(projectId)) {
        return null;
      }

      const created = await publishSkillPackage({
        file,
        projectId: toProjectId(projectId),
      });
      await refresh();
      return created;
    },
    [refresh, projectId],
  );

  const publishFromGithub = useCallback(
    async (githubUrl: string): Promise<SkillSummary | null> => {
      if (!isTruthy(projectId)) {
        return null;
      }

      const created = await publishSkillPackage({
        githubUrl,
        projectId: toProjectId(projectId),
      });
      await refresh();
      return created;
    },
    [refresh, projectId],
  );

  const inspectFile = useCallback(
    async (file: File): Promise<SkillInspectResult> => inspectSkillUpload({ file }),
    [],
  );

  const inspectGithub = useCallback(
    async (githubUrl: string): Promise<SkillInspectResult> => inspectSkillUpload({ githubUrl }),
    [],
  );

  const createSkillFork = useCallback(
    async (skillId: string): Promise<SkillSummary> => {
      if (!isTruthy(projectId)) {
        throw new Error(t("skills.projectRequired"));
      }

      const created = await createSkillForkRemote({
        projectId: toProjectId(projectId),
        skillId: toSkillId(skillId),
      });
      await refresh();
      return created;
    },
    [refresh, projectId, t],
  );

  const installSkillsShSkill = useCallback(
    async (input: {
      id: string;
      installUrl: string | null;
      slug: string;
    }): Promise<SkillSummary> => {
      if (!isTruthy(projectId)) {
        throw new Error(t("skills.projectRequired"));
      }

      const created = await installSkillsShSkillRemote({
        projectId: toProjectId(projectId),
        id: input.id,
        installUrl: input.installUrl,
        slug: input.slug,
      });
      await refresh();
      return created;
    },
    [refresh, projectId, t],
  );

  const deleteOwnedSkill = useCallback(
    async (skillId: string) => {
      if (!isTruthy(projectId)) {
        throw new Error(t("skills.projectRequired"));
      }

      await deleteOwnedSkillRemote(toProjectId(projectId), toSkillId(skillId));
      await refresh();
    },
    [refresh, projectId, t],
  );

  return {
    createSkillFork,
    deleteOwnedSkill,
    getSkill,
    getSkillDetail,
    getSkillSource,
    inspectFile,
    inspectGithub,
    installSkillsShSkill,
    loading: isTruthy(projectId) ? skillsQuery.isLoading : projectsLoading,
    personal,
    projectId,
    publishFromFile,
    publishFromGithub,
    refresh,
  };
}
