import { GraphQLError } from "graphql";

import { createErrorLogContext, logError } from "../../platform/cloudflare/logger";
import { isApiError, toApiErrorResponseDetails, unauthorizedError } from "../../platform/errors";
import type { AuthenticatedGraphQLContext, GraphQLContext } from "./graphql-context";

type GraphQLResolverFor<Context extends GraphQLContext> = {
  // Resolver implementations can narrow args to their schema-specific contract.
  resolve(parent: unknown, args: unknown, context: Context): unknown;
}["resolve"];

type GraphQLResolver = GraphQLResolverFor<GraphQLContext>;
type AuthenticatedGraphQLResolver = GraphQLResolverFor<AuthenticatedGraphQLContext>;

export interface GraphQLModule {
  authenticatedMutationResolvers?: Record<string, AuthenticatedGraphQLResolver>;
  authenticatedQueryResolvers?: Record<string, AuthenticatedGraphQLResolver>;
  mutationFields?: string[];
  mutationResolvers?: Record<string, GraphQLResolver>;
  queryFields?: string[];
  queryResolvers?: Record<string, GraphQLResolver>;
  typeDefs?: string;
}

function mergeFieldResolvers(
  target: Record<string, GraphQLResolver>,
  source: Record<string, GraphQLResolver> | undefined,
  typeName: string,
): void {
  if (!source) {
    return;
  }

  for (const [fieldName, resolver] of Object.entries(source)) {
    if (fieldName in target) {
      throw new Error(`Duplicate ${typeName} resolver registration: ${fieldName}.`);
    }

    target[fieldName] = withApiErrors(resolver, fieldName, typeName);
  }
}

function withAuthenticatedContext(resolver: AuthenticatedGraphQLResolver): GraphQLResolver {
  return (parent, args, context) => {
    if (context.viewer === null) {
      throw unauthorizedError();
    }

    return resolver(parent, args, {
      ...context,
      viewer: context.viewer,
    });
  };
}

function toGraphQLError(error: unknown): unknown {
  if (isApiError(error)) {
    const details = toApiErrorResponseDetails(error);
    return new GraphQLError(details.message, {
      extensions: {
        code: details.code,
        http: {
          status: details.status,
        },
      },
    });
  }

  // graphql-yoga's default `maskedErrors: true` replaces any non-GraphQLError
  // with the literal string "Unexpected error.", which hides actionable info
  // from admin operators. Wrap unknown Errors so the original message reaches
  // the client; the underlying error is also recorded via `logUnhandledResolverError`.
  if (error instanceof Error) {
    return new GraphQLError(error.message, {
      extensions: {
        code: "INTERNAL_ERROR",
        http: {
          status: 500,
        },
      },
    });
  }

  return new GraphQLError("Internal server error.", {
    extensions: {
      code: "INTERNAL_ERROR",
      http: {
        status: 500,
      },
    },
  });
}

function logUnhandledResolverError(
  error: unknown,
  operationContext: { fieldName: string; typeName: string },
): void {
  if (error instanceof Error) {
    logError("graphql.unhandled_resolver_error", {
      ...createErrorLogContext(error),
      operationName: operationContext.fieldName,
      operationType: operationContext.typeName,
    });
    return;
  }

  logError("graphql.unhandled_resolver_throw", {
    operationName: operationContext.fieldName,
    operationType: operationContext.typeName,
    valueType: typeof error,
  });
}

function withApiErrors(
  resolver: GraphQLResolver,
  fieldName: string,
  typeName: string,
): GraphQLResolver {
  return async (parent, args, context) => {
    try {
      return await resolver(parent, args, context);
    } catch (error) {
      if (!isApiError(error)) {
        logUnhandledResolverError(error, { fieldName, typeName });
      }

      throw toGraphQLError(error);
    }
  };
}

function mergeAuthenticatedFieldResolvers(
  target: Record<string, GraphQLResolver>,
  source: Record<string, AuthenticatedGraphQLResolver> | undefined,
  typeName: string,
): void {
  if (!source) {
    return;
  }

  const wrappedResolvers = Object.fromEntries(
    Object.entries(source).map(([fieldName, resolver]) => [
      fieldName,
      withAuthenticatedContext(resolver),
    ]),
  );

  mergeFieldResolvers(target, wrappedResolvers, typeName);
}

function collectRootFields(
  modules: GraphQLModule[],
  key: "queryFields" | "mutationFields",
): string[] {
  return modules.flatMap((module) => module[key] ?? []);
}

export function composeGraphQLModules(modules: GraphQLModule[]): {
  mutationFields: string[];
  mutationResolvers: Record<string, GraphQLResolver>;
  queryFields: string[];
  queryResolvers: Record<string, GraphQLResolver>;
  typeDefs: string[];
} {
  const queryResolvers: Record<string, GraphQLResolver> = {};
  const mutationResolvers: Record<string, GraphQLResolver> = {};
  const mutationFields = collectRootFields(modules, "mutationFields");

  for (const module of modules) {
    mergeFieldResolvers(queryResolvers, module.queryResolvers, "Query");
    mergeAuthenticatedFieldResolvers(queryResolvers, module.authenticatedQueryResolvers, "Query");
    mergeFieldResolvers(mutationResolvers, module.mutationResolvers, "Mutation");
    mergeAuthenticatedFieldResolvers(
      mutationResolvers,
      module.authenticatedMutationResolvers,
      "Mutation",
    );
  }

  return {
    mutationFields,
    mutationResolvers,
    queryFields: collectRootFields(modules, "queryFields"),
    queryResolvers,
    typeDefs: modules.flatMap((module) => (module.typeDefs ? [module.typeDefs] : [])),
  };
}
