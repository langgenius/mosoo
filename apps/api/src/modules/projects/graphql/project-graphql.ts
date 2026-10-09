import type { OrganizationId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { createProject } from "../application/project-provisioning.service";
import { listOrganizationProjects, renameProject } from "../application/project.service";

interface OrganizationIdArgs {
  organizationId: OrganizationId;
}

interface CreateProjectArgs {
  input: {
    name: string;
    organizationId: OrganizationId;
  };
}

interface RenameProjectArgs {
  input: Parameters<typeof renameProject>[2];
}

export const projectGraphQLModule = {
  authenticatedMutationResolvers: {
    createProject: async (_parent, args: CreateProjectArgs, context) =>
      createProject(context.bindings, context.viewer, args.input),
    renameProject: async (_parent, args: RenameProjectArgs, context) =>
      renameProject(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    projectList: async (_parent, args: OrganizationIdArgs, context) =>
      listOrganizationProjects(context.bindings.DB, context.viewer, args.organizationId),
  },
} satisfies GraphQLModule;
