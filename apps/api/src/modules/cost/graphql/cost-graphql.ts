import { parsePlatformId } from "@mosoo/id";
import type { AgentId, OrganizationId, AppId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { costGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  getAgentCostCard,
  getOrganizationBillingCostCard,
  getAppCostCard,
} from "../application/cost-query.service";
import type { CostRange } from "../application/cost-query.service";

interface OrganizationBillingCostCardArgs {
  organizationId: string;
  range: CostRange;
  runPurposes?: string[] | null;
}

interface AppCostCardArgs {
  appId: string;
  range: CostRange;
  runPurposes?: string[] | null;
}

interface AgentCostCardArgs {
  agentId: string;
  appId: string;
  range: CostRange;
  runPurposes?: string[] | null;
}

function readAgentId(value: string, label: string): AgentId {
  return parsePlatformId<AgentId>(value, label);
}

function readOrganizationId(value: string, label: string): OrganizationId {
  return parsePlatformId<OrganizationId>(value, label);
}

function readAppId(value: string, label: string): AppId {
  return parsePlatformId<AppId>(value, label);
}

export const costGraphQLModule = {
  ...costGraphQLSpec,
  authenticatedQueryResolvers: {
    agentCostCard: async (_parent, args: AgentCostCardArgs, context) =>
      getAgentCostCard({
        agentId: readAgentId(args.agentId, "agent ID"),
        database: context.bindings.DB,
        appId: readAppId(args.appId, "app ID"),
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
    appCostCard: async (_parent, args: AppCostCardArgs, context) =>
      getAppCostCard({
        database: context.bindings.DB,
        appId: readAppId(args.appId, "app ID"),
        range: args.range,
        runPurposes: args.runPurposes ?? [],
        viewer: context.viewer,
      }),
  },
} satisfies GraphQLModule;
