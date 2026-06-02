import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { auditGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { listAuditEvents } from "../application/audit-query.service";

interface AuditEventsArgs {
  filter: Parameters<typeof listAuditEvents>[2];
}

export const auditGraphQLModule = {
  ...auditGraphQLSpec,
  authenticatedQueryResolvers: {
    auditEvents: async (_parent, args: AuditEventsArgs, context) =>
      listAuditEvents(context.bindings.DB, context.viewer, args.filter),
  },
} satisfies GraphQLModule;
