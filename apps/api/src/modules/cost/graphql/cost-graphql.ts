import { parsePlatformId } from "@mosoo/id";
import type { AgentId, OrganizationId, ProjectId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { costGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  getAgentCostCard,
  getOrganizationBillingCostCard,
  getProjectCostCard,
} from "../application/cost-query.service";
import type { CostRange } from "../application/cost-query.service";

interface OrganizationBillingCostCardArgs {
  organizationId: string;
  range: CostRange;
  runPurposes?: string[] | null;
}

interface ProjectCostCardArgs {
  projectId: string;
  range: CostRange;
  runPurposes?: string[] | null;
}

interface AgentCostCardArgs {
  agentId: string;
  projectId: string;
  range: CostRange;
  runPurposes?: string[] | null;
}

function readAgentId(value: string, label: string): AgentId {
  return parsePlatformId<AgentId>(value, label);
}

function readOrganizationId(value: string, label: string): OrganizationId {
  return parsePlatformId<OrganizationId>(value, label);
}

function readProjectId(value: string, label: string): ProjectId {
  return parsePlatformId<ProjectId>(value, label);
}

export const costGraphQLModule = {
  ...costGraphQLSpec,
  authenticatedQueryResolvers: {
    agentCostCard: async (_parent, args: AgentCostCardArgs, context) =>
      getAgentCostCard({
        agentId: readAgentId(args.agentId, "agent ID"),
        database: context.bindings.DB,
        projectId: readProjectId(args.projectId, "project ID"),
        range: args.range,
        runPurposes: args.runPurposes ?? [],
        viewer: context.viewer,
      }),
    organizationBillingCostCard: async (_parent, args: OrganizationBillingCostCardArgs, context) =>
      getOrganizationBillingCostCard({
        database: context.bindings.DB,
        organizationId: readOrganizationId(args.organizationId, "organization ID"),
        range: args.range,
        runPurposes: args.runPurposes ?? [],
        viewer: context.viewer,
      }),
    projectCostCard: async (_parent, args: ProjectCostCardArgs, context) =>
      getProjectCostCard({
        database: context.bindings.DB,
        projectId: readProjectId(args.projectId, "project ID"),
        range: args.range,
        runPurposes: args.runPurposes ?? [],
        viewer: context.viewer,
      }),
  },
} satisfies GraphQLModule;
