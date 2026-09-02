import { parsePlatformId } from "@mosoo/id";
import type { OrganizationId, ProjectId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { projectGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  getProjectOverview,
  getControlPlaneOverview,
} from "../application/project-overview.service";
import { createProject } from "../application/project-provisioning.service";
import { listOrganizationProjects, renameProject } from "../application/project.service";

interface OrganizationIdArgs {
  organizationId: OrganizationId;
}

interface ProjectOverviewArgs {
  agentLimit?: number | null;
  projectId: string;
  credentialLimit?: number | null;
}

interface ControlPlaneOverviewArgs {
  agentLimit?: number | null;
  projectLimit?: number | null;
  credentialLimit?: number | null;
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

function parseProjectId(value: string): ProjectId {
  return parsePlatformId<ProjectId>(value, "Project ID");
}

export const projectGraphQLModule = {
  ...projectGraphQLSpec,
  authenticatedMutationResolvers: {
    createProject: async (_parent, args: CreateProjectArgs, context) =>
      createProject(context.bindings, context.viewer, args.input),
    renameProject: async (_parent, args: RenameProjectArgs, context) =>
      renameProject(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    projectList: async (_parent, args: OrganizationIdArgs, context) =>
      listOrganizationProjects(context.bindings.DB, context.viewer, args.organizationId),
    projectOverview: async (_parent, args: ProjectOverviewArgs, context) =>
      getProjectOverview(context.bindings.DB, context.viewer, {
        ...(args.agentLimit === undefined ? {} : { agentLimit: args.agentLimit }),
        projectId: parseProjectId(args.projectId),
        ...(args.credentialLimit === undefined ? {} : { credentialLimit: args.credentialLimit }),
      }),
    controlPlaneOverview: async (_parent, args: ControlPlaneOverviewArgs, context) =>
      getControlPlaneOverview(context.bindings.DB, context.viewer, {
        ...(args.agentLimit === undefined ? {} : { agentLimit: args.agentLimit }),
        ...(args.projectLimit === undefined ? {} : { projectLimit: args.projectLimit }),
        ...(args.credentialLimit === undefined ? {} : { credentialLimit: args.credentialLimit }),
      }),
  },
} satisfies GraphQLModule;
