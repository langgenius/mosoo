import type { SkillDetail, SkillInspectResult, SkillSummary } from "@mosoo/contracts/skill";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useAppSession } from "../../../app/session-provider";
import {
  createSkillFork as createSkillForkRemote,
  deleteOwnedSkill as deleteOwnedSkillRemote,
  fetchSkillSource,
  getSkillDetail as getSkillDetailRemote,
  inspectSkillUpload,
  publishSkillPackage,
} from "../../../domains/skill/api/skill-client";
import { skillKeys, useAppSkillsQuery } from "../../../domains/skill/query/skill-queries";
import { isTruthy } from "../../../shared/lib/truthiness";
import { toAppId, toSkillId } from "../../typed-id";
export function useSkillRegistry() {
  const queryClient = useQueryClient();
  const { activeAppId, appsLoading } = useAppSession();
  const appId = activeAppId;
  const skillsQuery = useAppSkillsQuery(appId);
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data]);

  const refresh = useCallback(async () => {
    if (!isTruthy(appId)) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: skillKeys.list(toAppId(appId)),
    });
  }, [queryClient, appId]);

  const personal = skills;

  const getSkill = useCallback(
    (skillId: string): SkillSummary | undefined => skills.find((skill) => skill.id === skillId),
    [skills],
  );

  const getSkillDetail = useCallback(
    async (skillId: string): Promise<SkillDetail> => {
      if (!isTruthy(appId)) {
        throw new Error("App is required.");
      }

      return getSkillDetailRemote(toAppId(appId), toSkillId(skillId));
    },
    [appId],
  );

  const getSkillSource = useCallback(
    async (skillId: string): Promise<string> => {
      if (!isTruthy(appId)) {
        throw new Error("App is required.");
      }

      return fetchSkillSource(toAppId(appId), toSkillId(skillId));
    },
    [appId],
  );

  const publishFromFile = useCallback(
    async (file: File): Promise<SkillSummary | null> => {
      if (!isTruthy(appId)) {
        return null;
      }

      const created = await publishSkillPackage({
        file,
        appId: toAppId(appId),
      });
      await refresh();
      return created;
    },
    [refresh, appId],
  );

  const publishFromGithub = useCallback(
    async (githubUrl: string): Promise<SkillSummary | null> => {
      if (!isTruthy(appId)) {
        return null;
      }

      const created = await publishSkillPackage({
        githubUrl,
        appId: toAppId(appId),
      });
      await refresh();
      return created;
    },
    [refresh, appId],
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
      if (!isTruthy(appId)) {
        throw new Error("App is required.");
      }

      const created = await createSkillForkRemote({
        appId: toAppId(appId),
        skillId: toSkillId(skillId),
      });
      await refresh();
      return created;
    },
    [refresh, appId],
  );

  const deleteOwnedSkill = useCallback(
    async (skillId: string) => {
      if (!isTruthy(appId)) {
        throw new Error("App is required.");
      }

      await deleteOwnedSkillRemote(toAppId(appId), toSkillId(skillId));
      await refresh();
    },
    [refresh, appId],
  );

  return {
    createSkillFork,
    deleteOwnedSkill,
    getSkill,
    getSkillDetail,
    getSkillSource,
    inspectFile,
    inspectGithub,
    loading: isTruthy(appId) ? skillsQuery.isLoading : appsLoading,
    personal,
    appId,
    publishFromFile,
    publishFromGithub,
    refresh,
  };
}
