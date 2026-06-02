import type {
  SkillDetail,
  SkillInspectResult,
  SkillShareTarget,
  SkillSummary,
} from "@mosoo/contracts/skill";
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
  shareSkillWithOrganization as shareSkillWithOrganizationRemote,
  shareSkillWithUser as shareSkillWithUserRemote,
  unshareSkillTarget as unshareSkillTargetRemote,
} from "../../../domains/skill/api/skill-client";
import { skillKeys, useOrganizationSkillsQuery } from "../../../domains/skill/query/skill-queries";
import { isTruthy } from "../../../shared/lib/truthiness";
import { toOrganizationId, toSkillId } from "../../typed-id";
export function useSkillRegistry() {
  const queryClient = useQueryClient();
  const { activeOrganization, organizationsLoading } = useAppSession();
  const organizationId = activeOrganization?.id ?? null;
  const skillsQuery = useOrganizationSkillsQuery(organizationId);
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data]);

  const refresh = useCallback(async () => {
    if (!isTruthy(organizationId)) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: skillKeys.list(toOrganizationId(organizationId)),
    });
  }, [queryClient, organizationId]);

  const personal = useMemo(() => skills.filter((skill) => skill.role === "owner"), [skills]);
  const shared = useMemo(() => skills.filter((skill) => skill.role === "user"), [skills]);

  const getSkill = useCallback(
    (skillId: string): SkillSummary | undefined => skills.find((skill) => skill.id === skillId),
    [skills],
  );

  const getSkillDetail = useCallback(
    async (skillId: string): Promise<SkillDetail> => getSkillDetailRemote(toSkillId(skillId)),
    [],
  );

  const getSkillSource = useCallback(
    async (skillId: string): Promise<string> => fetchSkillSource(toSkillId(skillId)),
    [],
  );

  const publishFromFile = useCallback(
    async (file: File): Promise<SkillSummary | null> => {
      if (!isTruthy(organizationId)) {
        return null;
      }

      const created = await publishSkillPackage({
        file,
        organizationId: toOrganizationId(organizationId),
      });
      await refresh();
      return created;
    },
    [refresh, organizationId],
  );

  const publishFromGithub = useCallback(
    async (githubUrl: string): Promise<SkillSummary | null> => {
      if (!isTruthy(organizationId)) {
        return null;
      }

      const created = await publishSkillPackage({
        githubUrl,
        organizationId: toOrganizationId(organizationId),
      });
      await refresh();
      return created;
    },
    [refresh, organizationId],
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
      const created = await createSkillForkRemote({ skillId: toSkillId(skillId) });
      await refresh();
      return created;
    },
    [refresh],
  );

  const deleteOwnedSkill = useCallback(
    async (skillId: string) => {
      await deleteOwnedSkillRemote(toSkillId(skillId));
      await refresh();
    },
    [refresh],
  );

  const shareSkillWithUser = useCallback(
    async (skillId: string, email: string) =>
      shareSkillWithUserRemote({
        email,
        skillId: toSkillId(skillId),
      }),
    [],
  );

  const shareSkillWithOrganization = useCallback(
    async (skillId: string) =>
      shareSkillWithOrganizationRemote({
        skillId: toSkillId(skillId),
      }),
    [],
  );

  const unshareSkillTarget = useCallback(async (skillId: string, target: SkillShareTarget) => {
    await unshareSkillTargetRemote({
      skillId: toSkillId(skillId),
      targetId: target.id,
      targetKind: target.kind,
    });
  }, []);

  return {
    createSkillFork,
    deleteOwnedSkill,
    getSkill,
    getSkillDetail,
    getSkillSource,
    inspectFile,
    inspectGithub,
    loading: isTruthy(organizationId) ? skillsQuery.isLoading : organizationsLoading,
    organizationId,
    personal,
    publishFromFile,
    publishFromGithub,
    refresh,
    shareSkillWithOrganization,
    shareSkillWithUser,
    shared,
    unshareSkillTarget,
  };
}
