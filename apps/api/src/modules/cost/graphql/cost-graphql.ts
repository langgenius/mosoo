import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, OrganizationId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { costGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  getAgentCostCard,
  getMemberCostCard,
  getOrganizationCostCard,
  getOwnerCostCard,
} from "../application/cost-query.service";
import type { CostRange } from "../application/cost-query.service";

interface OrganizationCostCardArgs {
  organizationId: string;
  range: CostRange;
  runPurposes?: string[] | null;
}

interface AgentCostCardArgs {
  agentId: string;
  range: CostRange;
  runPurposes?: string[] | null;
}

interface MemberCostCardArgs extends OrganizationCostCardArgs {
  memberId: string;
}

interface OwnerCostCardArgs extends OrganizationCostCardArgs {
  ownerUserId: string;
}

function readAccountId(value: string, label: string): AccountId {
  return parsePlatformId<AccountId>(value, label);
}

function readAgentId(value: string, label: string): AgentId {
  return parsePlatformId<AgentId>(value, label);
}

function readOrganizationId(value: string, label: string): OrganizationId {
  return parsePlatformId<OrganizationId>(value, label);
}

export const costGraphQLModule = {
  ...costGraphQLSpec,
  authenticatedQueryResolvers: {
    agentCostCard: async (_parent, args: AgentCostCardArgs, context) =>
      getAgentCostCard({
        agentId: readAgentId(args.agentId, "agent ID"),
        database: context.bindings.DB,
        range: args.range,
        runPurposes: args.runPurposes ?? [],
        viewer: context.viewer,
      }),
    memberCostCard: async (_parent, args: MemberCostCardArgs, context) =>
      getMemberCostCard({
        database: context.bindings.DB,
        memberId: readAccountId(args.memberId, "member account ID"),
        organizationId: readOrganizationId(args.organizationId, "organization ID"),
        range: args.range,
        viewer: context.viewer,
      }),
    organizationCostCard: async (_parent, args: OrganizationCostCardArgs, context) =>
      getOrganizationCostCard({
        database: context.bindings.DB,
        organizationId: readOrganizationId(args.organizationId, "organization ID"),
        range: args.range,
        runPurposes: args.runPurposes ?? [],
        viewer: context.viewer,
      }),
    ownerCostCard: async (_parent, args: OwnerCostCardArgs, context) =>
      getOwnerCostCard({
        database: context.bindings.DB,
        organizationId: readOrganizationId(args.organizationId, "organization ID"),
        ownerUserId: readAccountId(args.ownerUserId, "owner account ID"),
        range: args.range,
        viewer: context.viewer,
      }),
  },
} satisfies GraphQLModule;
