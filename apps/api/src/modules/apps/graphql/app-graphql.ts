import type { OrganizationId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { appGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { createApp } from "../application/app-provisioning.service";
import { listOrganizationApps } from "../application/app.service";

interface OrganizationIdArgs {
  organizationId: OrganizationId;
}

interface CreateAppArgs {
  input: {
    name: string;
    organizationId: OrganizationId;
  };
}

export const appGraphQLModule = {
  ...appGraphQLSpec,
  authenticatedMutationResolvers: {
    createApp: async (_parent, args: CreateAppArgs, context) =>
      createApp(context.bindings.DB, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    appList: async (_parent, args: OrganizationIdArgs, context) =>
      listOrganizationApps(context.bindings.DB, context.viewer, args.organizationId),
  },
} satisfies GraphQLModule;
