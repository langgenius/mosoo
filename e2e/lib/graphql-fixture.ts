import type { Route } from "@playwright/test";

import { formatHarnessError } from "./env-preflight";

/**
 * GraphQL request-interception primitives shared by the deterministic L1
 * specs. Each spec routes `**\/api/graphql` to its own `switch (operationName)`
 * fixture; these helpers parse the request envelope, recover the operation
 * name (even when the client omits `operationName`), and fulfill a `{ data }`
 * body. An operation the spec does not fixture is a contract gap by design —
 * the spec's own default branch throws so the missing projection surfaces
 * instead of silently depending on live services.
 */

export interface GraphQLRequestBody {
  operationName?: string;
  query: string;
  variables?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseGraphQLRequestBody(postData: string | null): GraphQLRequestBody {
  if (postData === null) {
    throw new Error(
      formatHarnessError({
        fix: "Use requestGraphQL(...) so the fixture can assert the operation and variables.",
        what: "The deterministic E2E received an empty GraphQL request body.",
        why: "L1 deterministic E2E must pin every API projection it depends on.",
      }),
    );
  }

  const parsed: unknown = JSON.parse(postData);

  if (!isRecord(parsed) || typeof parsed["query"] !== "string") {
    throw new Error(
      formatHarnessError({
        fix: "Send `{ query, variables }` from the Web GraphQL client or add a parser case for the new envelope.",
        what: "The deterministic E2E received a GraphQL request envelope it cannot parse.",
        why: "The fixture is the executable contract for the Web/API projection in this no-credential harness.",
      }),
    );
  }

  return {
    ...(typeof parsed["operationName"] === "string"
      ? { operationName: parsed["operationName"] }
      : {}),
    query: parsed["query"],
    ...(isRecord(parsed["variables"]) ? { variables: parsed["variables"] } : {}),
  };
}

function isGraphQLNameStart(value: string): boolean {
  const code = value.charCodeAt(0);

  return value === "_" || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isGraphQLNameContinue(value: string): boolean {
  const code = value.charCodeAt(0);

  return isGraphQLNameStart(value) || (code >= 48 && code <= 57);
}

function skipGraphQLIgnored(query: string, start: number): number {
  let index = start;

  while (index < query.length) {
    const value = query[index];

    if (value === " " || value === "\n" || value === "\r" || value === "\t" || value === ",") {
      index += 1;
      continue;
    }

    return index;
  }

  return index;
}

function readGraphQLName(query: string, start: number): { end: number; name: string } | null {
  const first = query[start];

  if (first === undefined || !isGraphQLNameStart(first)) {
    return null;
  }

  let end = start + 1;

  while (end < query.length) {
    const value = query[end];

    if (value === undefined || !isGraphQLNameContinue(value)) {
      break;
    }

    end += 1;
  }

  return {
    end,
    name: query.slice(start, end),
  };
}

export function getOperationName(body: GraphQLRequestBody): string | null {
  if (body.operationName !== undefined && body.operationName.trim().length > 0) {
    return body.operationName;
  }

  const operation = readGraphQLName(body.query, skipGraphQLIgnored(body.query, 0));

  if (operation === null || (operation.name !== "query" && operation.name !== "mutation")) {
    return null;
  }

  const nameStart = skipGraphQLIgnored(body.query, operation.end);

  if (body.query[nameStart] === "{" || body.query[nameStart] === "(") {
    return null;
  }

  return readGraphQLName(body.query, nameStart)?.name ?? null;
}

export async function fulfillJson(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    status: 200,
  });
}
