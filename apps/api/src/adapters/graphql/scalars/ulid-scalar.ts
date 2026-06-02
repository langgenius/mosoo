import { parsePlatformId } from "@mosoo/id";
import { GraphQLError, GraphQLScalarType, Kind } from "graphql";
import type { ValueNode } from "graphql";

export const ulidScalar = new GraphQLScalarType({
  description: "A platform ULID. Input may use lowercase; output is canonical uppercase.",
  name: "ULID",
  parseLiteral(valueNode): string {
    return parseUlidLiteral(valueNode);
  },
  parseValue(value): string {
    return parseUlidValue(value);
  },
  serialize(value): string {
    return parseUlidValue(value);
  },
});

function parseUlidValue(value: unknown): string {
  try {
    return parsePlatformId(value, "ULID");
  } catch {
    throw new GraphQLError("ULID must be a valid platform ULID.");
  }
}

function parseUlidLiteral(valueNode: ValueNode): string {
  if (valueNode.kind !== Kind.STRING) {
    throw new GraphQLError("ULID literal must be a string.");
  }

  return parseUlidValue(valueNode.value);
}
