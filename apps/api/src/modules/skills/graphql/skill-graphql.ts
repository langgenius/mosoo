import { parsePlatformId } from "@mosoo/id";
import type { ProjectId, SkillId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { skillGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { createSkillFork, deleteOwnedSkill } from "../application/skill-lifecycle.service";
import { getSkillDetail, listProjectSkills } from "../application/skill-query.service";

interface ProjectSkillArgs {
  projectId: string;
  skillId: string;
}

interface ProjectIdArgs {
  projectId: string;
}

interface CreateSkillForkArgs {
  input: Parameters<typeof createSkillFork>[2];
}

export const skillGraphQLModule = {
  ...skillGraphQLSpec,
  authenticatedMutationResolvers: {
    createSkillFork: async (_parent, args: CreateSkillForkArgs, context) =>
      createSkillFork(context.bindings.DB, context.viewer, args.input),
    deleteOwnedSkill: async (_parent, args: ProjectSkillArgs, context) => {
      const projectId = parsePlatformId<ProjectId>(args.projectId, "project ID");
      const skillId = parsePlatformId<SkillId>(args.skillId, "skill ID");
      await deleteOwnedSkill(context.bindings.DB, context.viewer, projectId, skillId);
      return { ok: true } as const;
    },
  },
  authenticatedQueryResolvers: {
    projectSkillList: async (_parent, args: ProjectIdArgs, context) => {
      const projectId = parsePlatformId<ProjectId>(args.projectId, "project ID");
      return listProjectSkills(context.bindings.DB, context.viewer, projectId);
    },
    skillDetail: async (_parent, args: ProjectSkillArgs, context) => {
      const projectId = parsePlatformId<ProjectId>(args.projectId, "project ID");
      const skillId = parsePlatformId<SkillId>(args.skillId, "skill ID");
      return getSkillDetail(context.bindings.DB, context.viewer, projectId, skillId);
    },
  },
} satisfies GraphQLModule;
