import type { ProjectId, SkillId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { createSkillFork, deleteOwnedSkill } from "../application/skill-lifecycle.service";
import { getSkillDetail, listProjectSkills } from "../application/skill-query.service";

interface ProjectSkillArgs {
  projectId: ProjectId;
  skillId: SkillId;
}

interface ProjectIdArgs {
  projectId: ProjectId;
}

interface CreateSkillForkArgs {
  input: Parameters<typeof createSkillFork>[2];
}

export const skillGraphQLModule = {
  authenticatedMutationResolvers: {
    createSkillFork: async (_parent, args: CreateSkillForkArgs, context) =>
      createSkillFork(context.bindings.DB, context.viewer, args.input),
    deleteOwnedSkill: async (_parent, args: ProjectSkillArgs, context) => {
      await deleteOwnedSkill(context.bindings.DB, context.viewer, args.projectId, args.skillId);
      return { ok: true } as const;
    },
  },
  authenticatedQueryResolvers: {
    projectSkillList: async (_parent, args: ProjectIdArgs, context) =>
      listProjectSkills(context.bindings.DB, context.viewer, args.projectId),
    skillDetail: async (_parent, args: ProjectSkillArgs, context) =>
      getSkillDetail(context.bindings.DB, context.viewer, args.projectId, args.skillId),
  },
} satisfies GraphQLModule;
