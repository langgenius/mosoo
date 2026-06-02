import type { GraphQLModule } from "../graphql-module";
import { commonGraphQLSpec } from "../graphql-module-specs";

export const commonGraphQLModule = {
  ...commonGraphQLSpec,
  queryResolvers: {
    appInfo: (_parent, _args, context) => ({
      api: "graphql-yoga",
      name: context.bindings.APP_NAME,
      runtime: "cloudflare-workers",
    }),
  },
} satisfies GraphQLModule;
