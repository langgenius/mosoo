import type { AgentId, ProjectId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { getAgentCostCard, getProjectCostCard } from "../application/cost-query.service";
import type { CostRange } from "../application/cost-query.service";

interface ProjectCostCardArgs {
  projectId: ProjectId;
  range: CostRange;
  runPurposes?: string[] | null;
}

interface AgentCostCardArgs extends ProjectCostCardArgs {
  agentId: AgentId;
}

export const costGraphQLModule = {
  authenticatedQueryResolvers: {
    agentCostCard: async (_parent, args: AgentCostCardArgs, context) =>
      getAgentCostCard({
        agentId: args.agentId,
        database: context.bindings.DB,
        projectId: args.projectId,
        range: args.range,
        runPurposes: args.runPurposes ?? [],
        viewer: context.viewer,
      }),
    projectCostCard: async (_parent, args: ProjectCostCardArgs, context) =>
      getProjectCostCard({
        database: context.bindings.DB,
        projectId: args.projectId,
        range: args.range,
        runPurposes: args.runPurposes ?? [],
        viewer: context.viewer,
      }),
  },
} satisfies GraphQLModule;
