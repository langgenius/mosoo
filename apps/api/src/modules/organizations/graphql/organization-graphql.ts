import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { renameOrganization } from "../application/organization.service";

interface RenameOrganizationArgs {
  input: Parameters<typeof renameOrganization>[2];
}

export const organizationGraphQLModule = {
  authenticatedMutationResolvers: {
    renameOrganization: async (_parent, args: RenameOrganizationArgs, context) =>
      renameOrganization(context.bindings.DB, context.viewer, args.input),
  },
} satisfies GraphQLModule;
