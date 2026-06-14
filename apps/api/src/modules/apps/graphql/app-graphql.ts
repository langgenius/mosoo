import type { OrganizationId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { appGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { listOrganizationApps } from "../application/app.service";

interface OrganizationIdArgs {
  organizationId: OrganizationId;
}

export const appGraphQLModule = {
  ...appGraphQLSpec,
  authenticatedQueryResolvers: {
    appList: async (_parent, args: OrganizationIdArgs, context) =>
      listOrganizationApps(context.bindings.DB, context.viewer, args.organizationId),
  },
} satisfies GraphQLModule;
