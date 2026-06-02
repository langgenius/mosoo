import type { TypedDocumentString } from "@/gql/graphql";

import { apiFetch } from "./public-api";

interface GraphQLErrorEntry {
  extensions?: {
    code?: string;
  };
  message: string;
}

interface GraphQLResponse<TData> {
  data?: TData;
  errors?: GraphQLErrorEntry[];
}

type GraphQLResponseEnvelope = GraphQLResponse<unknown>;

export class UnauthorizedError extends Error {
  public constructor(message = "Session expired. Please sign in again.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

function parseGraphQLErrorEntry(value: unknown): GraphQLErrorEntry | null {
  if (!isJsonObject(value) || typeof value["message"] !== "string") {
    return null;
  }

  const extensions = value["extensions"];
  const code =
    isJsonObject(extensions) && typeof extensions["code"] === "string"
      ? extensions["code"]
      : undefined;

  return code === undefined
    ? { message: value["message"] }
    : {
        extensions: { code },
        message: value["message"],
      };
}

function parseGraphQLResponseEnvelope(value: unknown): GraphQLResponseEnvelope {
  if (!isJsonObject(value)) {
    return {};
  }

  const errors = Array.isArray(value["errors"])
    ? value["errors"]
        .map((entry) => parseGraphQLErrorEntry(entry))
        .filter((entry): entry is GraphQLErrorEntry => entry !== null)
    : undefined;

  return errors === undefined
    ? { data: value["data"] }
    : {
        data: value["data"],
        errors,
      };
}

function getGraphQLErrorMessage(payload: GraphQLResponseEnvelope): string | null {
  if (payload.errors === undefined || payload.errors.length === 0) {
    return null;
  }

  return payload.errors.map((entry) => entry.message).join("; ");
}

async function readGraphQLHttpError(response: Response): Promise<string> {
  try {
    const payload = parseGraphQLResponseEnvelope(await readJson(response));
    const message = getGraphQLErrorMessage(payload);

    if (message !== null) {
      return message;
    }
  } catch {
    /* Fall through to status text */
  }

  return `${response.status} ${response.statusText}`;
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
    throw new Error(await readGraphQLHttpError(response));
  }

  const payload = parseGraphQLResponseEnvelope(await readJson(response));

  const graphQLErrorMessage = getGraphQLErrorMessage(payload);

  if (graphQLErrorMessage !== null) {
    const errors = payload.errors ?? [];

    if (
      errors.some(
        (entry) =>
          entry.extensions?.code === "UNAUTHENTICATED" || entry.extensions?.code === "UNAUTHORIZED",
      )
    ) {
      throw new UnauthorizedError();
    }

    if (errors.some((entry) => entry.extensions?.code === "FORBIDDEN")) {
      throw new Error("You do not have permission to perform this action.");
    }

    throw new Error(graphQLErrorMessage);
  }

  if (payload.data === undefined) {
    throw new Error("The GraphQL response did not include data.");
  }

  return payload.data as TData;
}
