import { parsePlatformId } from "@mosoo/id";
import type { AppId, SkillId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { skillGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { createSkillFork, deleteOwnedSkill } from "../application/skill-lifecycle.service";
import { getSkillDetail, listAppSkills } from "../application/skill-query.service";

interface AppSkillArgs {
  appId: string;
  skillId: string;
}

interface AppIdArgs {
  appId: string;
}

interface CreateSkillForkArgs {
  input: Parameters<typeof createSkillFork>[2];
}

export const skillGraphQLModule = {
  ...skillGraphQLSpec,
  authenticatedMutationResolvers: {
    createSkillFork: async (_parent, args: CreateSkillForkArgs, context) =>
      createSkillFork(context.bindings.DB, context.viewer, args.input),
    deleteOwnedSkill: async (_parent, args: AppSkillArgs, context) => {
      const appId = parsePlatformId<AppId>(args.appId, "app ID");
      const skillId = parsePlatformId<SkillId>(args.skillId, "skill ID");
      await deleteOwnedSkill(context.bindings.DB, context.viewer, appId, skillId);
      return { ok: true } as const;
    },
  },
  authenticatedQueryResolvers: {
    appSkillList: async (_parent, args: AppIdArgs, context) => {
      const appId = parsePlatformId<AppId>(args.appId, "app ID");
      return listAppSkills(context.bindings.DB, context.viewer, appId);
    },
    skillDetail: async (_parent, args: AppSkillArgs, context) => {
      const appId = parsePlatformId<AppId>(args.appId, "app ID");
      const skillId = parsePlatformId<SkillId>(args.skillId, "skill ID");
      return getSkillDetail(context.bindings.DB, context.viewer, appId, skillId);
    },
  },
} satisfies GraphQLModule;
