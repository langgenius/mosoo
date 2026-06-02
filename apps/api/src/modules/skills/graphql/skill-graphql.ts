import { parsePlatformId } from "@mosoo/id";
import type { OrganizationId, SkillId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { skillGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { createSkillFork, deleteOwnedSkill } from "../application/skill-lifecycle.service";
import {
  getSkillDetail,
  listOrganizationSkills,
  listSkillShareTargets,
} from "../application/skill-query.service";
import {
  setSkillAutoEnabled,
  shareSkillWithOrganization,
  shareSkillWithUser,
  unshareSkillTarget,
} from "../application/skill-sharing.service";

interface OrganizationIdArgs {
  organizationId: string;
}

interface SkillIdArgs {
  skillId: string;
}

interface SetSkillAutoEnabledArgs {
  input: Parameters<typeof setSkillAutoEnabled>[2];
}

interface CreateSkillForkArgs {
  input: Parameters<typeof createSkillFork>[2];
}

interface ShareSkillWithUserArgs {
  input: Parameters<typeof shareSkillWithUser>[2];
}

interface ShareSkillWithOrganizationArgs {
  input: Parameters<typeof shareSkillWithOrganization>[2];
}

interface UnshareSkillTargetArgs {
  input: Parameters<typeof unshareSkillTarget>[2];
}

export const skillGraphQLModule = {
  ...skillGraphQLSpec,
  authenticatedMutationResolvers: {
    createSkillFork: async (_parent, args: CreateSkillForkArgs, context) =>
      createSkillFork(context.bindings.DB, context.viewer, args.input),
    deleteOwnedSkill: async (_parent, args: SkillIdArgs, context) => {
      const skillId = parsePlatformId<SkillId>(args.skillId, "skill ID");
      await deleteOwnedSkill(context.bindings.DB, context.viewer, skillId);
      return { ok: true } as const;
    },
    setSkillAutoEnabled: async (_parent, args: SetSkillAutoEnabledArgs, context) =>
      setSkillAutoEnabled(context.bindings.DB, context.viewer, args.input),
    shareSkillWithOrganization: async (_parent, args: ShareSkillWithOrganizationArgs, context) =>
      shareSkillWithOrganization(context.bindings.DB, context.viewer, args.input),
    shareSkillWithUser: async (_parent, args: ShareSkillWithUserArgs, context) =>
      shareSkillWithUser(context.bindings.DB, context.viewer, args.input),
    unshareSkillTarget: async (_parent, args: UnshareSkillTargetArgs, context) => {
      await unshareSkillTarget(context.bindings.DB, context.viewer, args.input);
      return { ok: true } as const;
    },
  },
  authenticatedQueryResolvers: {
    organizationSkillList: async (_parent, args: OrganizationIdArgs, context) => {
      const organizationId = parsePlatformId<OrganizationId>(
        args.organizationId,
        "organization ID",
      );
      return listOrganizationSkills(context.bindings.DB, context.viewer, organizationId);
    },
    skillDetail: async (_parent, args: SkillIdArgs, context) => {
      const skillId = parsePlatformId<SkillId>(args.skillId, "skill ID");
      return getSkillDetail(context.bindings.DB, context.viewer, skillId);
    },
    skillShareTargetList: async (_parent, args: SkillIdArgs, context) => {
      const skillId = parsePlatformId<SkillId>(args.skillId, "skill ID");
      return listSkillShareTargets(context.bindings.DB, context.viewer, skillId);
    },
  },
} satisfies GraphQLModule;
