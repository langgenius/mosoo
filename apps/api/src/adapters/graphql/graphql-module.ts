import { DrizzleQueryError } from "drizzle-orm/errors";
import { GraphQLError } from "graphql";

import { createErrorLogContext, logError } from "../../platform/cloudflare/logger";
import {
  forbiddenError,
  isApiError,
  toApiErrorResponseDetails,
  unauthorizedError,
} from "../../platform/errors";
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
  queryResolvers?: Record<string, GraphQLResolver>;
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

function toGraphQLError(error: unknown): GraphQLError {
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
  // from admin operators. Wrap unknown errors so the original message reaches
  // the client; `withApiErrors` also logs the underlying error. Database driver
  // errors embed SQL and bound parameters, so their messages stay in the logs.
  const exposeMessage =
    error instanceof Error &&
    !(error instanceof DrizzleQueryError) &&
    !error.message.includes("D1_ERROR");

  return new GraphQLError(exposeMessage ? error.message : "Internal server error.", {
    extensions: {
      code: "INTERNAL_ERROR",
      http: {
        status: 500,
      },
    },
  });
}

// Only reviewed, explicitly Project-addressed operations accept application keys.
const PROJECT_KEY_OPERATIONS = new Set([
  "Query.accessibleAgentList",
  "Query.agent",
  "Query.agentEditorState",
  "Mutation.createAgent",
  "Mutation.updateAgentConfig",
  "Mutation.deleteAgent",
  "Mutation.publishAgent",
  "Mutation.unpublishAgent",
]);

function authorizeProjectKeyOperation(
  context: GraphQLContext,
  args: unknown,
  operation: string,
): void {
  const projectId = context.viewer?.projectId;
  if (projectId === undefined) return;
  if (!PROJECT_KEY_OPERATIONS.has(operation)) {
    throw forbiddenError("Use an account login for this operation.");
  }
  const input = typeof args === "object" && args !== null && "input" in args ? args.input : args;
  if (
    typeof input !== "object" ||
    input === null ||
    !("projectId" in input) ||
    input.projectId !== projectId
  ) {
    throw forbiddenError("This API key cannot access another Project.");
  }
}

function withApiErrors(
  resolver: GraphQLResolver,
  fieldName: string,
  typeName: string,
): GraphQLResolver {
  return async (parent, args, context) => {
    try {
      authorizeProjectKeyOperation(context, args, `${typeName}.${fieldName}`);
      return await resolver(parent, args, context);
    } catch (error) {
      if (!isApiError(error)) {
        logError("graphql.unhandled_resolver_error", {
          ...createErrorLogContext(error),
          operationName: fieldName,
          operationType: typeName,
        });
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

export function composeGraphQLModules(modules: GraphQLModule[]): {
  mutationResolvers: Record<string, GraphQLResolver>;
  queryResolvers: Record<string, GraphQLResolver>;
} {
  const queryResolvers: Record<string, GraphQLResolver> = {};
  const mutationResolvers: Record<string, GraphQLResolver> = {};

  for (const module of modules) {
    mergeFieldResolvers(queryResolvers, module.queryResolvers, "Query");
    mergeAuthenticatedFieldResolvers(queryResolvers, module.authenticatedQueryResolvers, "Query");
    mergeAuthenticatedFieldResolvers(
      mutationResolvers,
      module.authenticatedMutationResolvers,
      "Mutation",
    );
  }

  return { mutationResolvers, queryResolvers };
}
