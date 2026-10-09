import type { SkillSummary } from "@mosoo/contracts/skill";
import type { SkillId } from "@mosoo/id";
import { useQueryClient } from "@tanstack/react-query";

import { useActiveProject } from "../../../app/session/session-context";
import {
  createSkillFork as createSkillForkRemote,
  deleteOwnedSkill as deleteOwnedSkillRemote,
  installSkillsShSkill as installSkillsShSkillRemote,
  publishSkillPackage,
} from "../../../domains/skill/api/skill-client";
import { skillKeys, useProjectSkillsQuery } from "../../../domains/skill/query/skill-queries";

export function useSkillRegistry() {
  const queryClient = useQueryClient();
  const projectId = useActiveProject().id;
  const skillsQuery = useProjectSkillsQuery(projectId);
  const skills = skillsQuery.data ?? [];

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: skillKeys.list(projectId) });
  }

  function getSkill(skillId: SkillId): SkillSummary | undefined {
    return skills.find((skill) => skill.id === skillId);
  }

  async function publishFromFile(file: File): Promise<SkillSummary> {
    const created = await publishSkillPackage({ file, projectId });
    await refresh();
    return created;
  }

  async function publishFromGithub(githubUrl: string): Promise<SkillSummary> {
    const created = await publishSkillPackage({ githubUrl, projectId });
    await refresh();
    return created;
  }

  async function createSkillFork(skillId: SkillId): Promise<SkillSummary> {
    const created = await createSkillForkRemote({ projectId, skillId });
    await refresh();
    return created;
  }

  async function installSkillsShSkill(input: {
    id: string;
    installUrl: string | null;
    slug: string;
  }): Promise<SkillSummary> {
    const created = await installSkillsShSkillRemote({ ...input, projectId });
    await refresh();
    return created;
  }

  async function deleteOwnedSkill(skillId: SkillId): Promise<void> {
    await deleteOwnedSkillRemote(projectId, skillId);
    await refresh();
  }

  return {
    createSkillFork,
    deleteOwnedSkill,
    getSkill,
    installSkillsShSkill,
    loading: skillsQuery.isLoading,
    publishFromFile,
    publishFromGithub,
    skills,
  };
}
