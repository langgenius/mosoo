import { SESSION_PROCESS_EVENT_TYPE_BY_CODE } from "@mosoo/contracts/session";
import { createSchema } from "graphql-yoga";

import { agentGraphQLModule } from "../../modules/agents/graphql/agent-graphql";
import { appGraphQLModule } from "../../modules/apps/graphql/app-graphql";
import { channelGraphQLModule } from "../../modules/channels/graphql/channel-graphql";
import { costGraphQLModule } from "../../modules/cost/graphql/cost-graphql";
import { environmentGraphQLModule } from "../../modules/environments/graphql/environment-graphql";
import { fileGraphQLModule } from "../../modules/files/graphql/file-graphql";
import { mcpGraphQLModule } from "../../modules/mcp/graphql/mcp-graphql";
import { onboardingGraphQLModule } from "../../modules/onboarding/graphql/onboarding-graphql";
import { organizationGraphQLModule } from "../../modules/organizations/graphql/organization-graphql";
import { sessionGraphQLModule } from "../../modules/sessions/graphql/session-graphql";
import { skillGraphQLModule } from "../../modules/skills/graphql/skill-graphql";
import { userGraphQLModule } from "../../modules/users/graphql/user-graphql";
import { vendorCredentialGraphQLModule } from "../../modules/vendor-credentials/graphql/vendor-credential-graphql";
import type { GraphQLContext } from "./graphql-context";
import { composeGraphQLModules } from "./graphql-module";
import { commonGraphQLModule } from "./modules/common-graphql";
import { jsonObjectScalar } from "./scalars/json-object-scalar";
import { primitiveRecordScalar } from "./scalars/primitive-record-scalar";
import { ulidScalar } from "./scalars/ulid-scalar";

const composedGraphQLModules = composeGraphQLModules([
  commonGraphQLModule,
  agentGraphQLModule,
  channelGraphQLModule,
  costGraphQLModule,
  environmentGraphQLModule,
  fileGraphQLModule,
  mcpGraphQLModule,
  onboardingGraphQLModule,
  organizationGraphQLModule,
  appGraphQLModule,
  sessionGraphQLModule,
  skillGraphQLModule,
  userGraphQLModule,
  vendorCredentialGraphQLModule,
]);

const typeDefs = /* GraphQL */ `
  ${composedGraphQLModules.typeDefs.join("\n")}

  type Query {
    ${composedGraphQLModules.queryFields.join("\n    ")}
  }

  type Mutation {
    ${composedGraphQLModules.mutationFields.join("\n    ")}
  }
`;

export function createGraphQLSchema() {
  return createSchema<GraphQLContext>({
    resolvers: {
      Mutation: composedGraphQLModules.mutationResolvers,
      JsonObject: jsonObjectScalar,
      PrimitiveRecord: primitiveRecordScalar,
      Query: composedGraphQLModules.queryResolvers,
      SessionProcessEventType: SESSION_PROCESS_EVENT_TYPE_BY_CODE,
      ULID: ulidScalar,
    },
    typeDefs,
  });
}
