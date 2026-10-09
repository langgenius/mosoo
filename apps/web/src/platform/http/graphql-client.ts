import type { TypedDocumentString } from "@/gql/graphql";

import { apiFetch } from "./public-api";

interface GraphQLResponse<TData> {
  data?: TData;
  errors?: { message: string }[];
}

export class UnauthorizedError extends Error {
  public constructor(message = "Session expired. Please sign in again.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function getGraphQLErrorMessage(payload: GraphQLResponse<unknown> | null): string | null {
  const messages = payload?.errors?.map((entry) => entry.message) ?? [];
  return messages.length === 0 ? null : messages.join("; ");
}

export async function requestGraphQL<TData, TVariables>(
  query: TypedDocumentString<TData, TVariables>,
  ...[variables]: TVariables extends Record<string, never> ? [] : [TVariables]
): Promise<TData> {
  const response = await apiFetch("/graphql", {
    body: JSON.stringify(
      variables === undefined
        ? {
            query: query.toString(),
          }
        : {
            query: query.toString(),
            variables,
          },
    ),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (response.status === 401) {
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as GraphQLResponse<unknown> | null;
    throw new Error(getGraphQLErrorMessage(payload) ?? `${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as GraphQLResponse<TData>;
  const graphQLErrorMessage = getGraphQLErrorMessage(payload);

  if (graphQLErrorMessage !== null) {
    throw new Error(graphQLErrorMessage);
  }

  if (payload.data === undefined) {
    throw new Error("The GraphQL response did not include data.");
  }

  return payload.data;
}
