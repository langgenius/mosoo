import type { JsonObject } from "@mosoo/contracts";
import { parseJsonObject } from "@mosoo/contracts/validation";
import { GraphQLError, GraphQLScalarType, Kind, valueFromASTUntyped } from "graphql";
import type { ValueNode } from "graphql";

export const jsonObjectScalar = new GraphQLScalarType({
  description: "A recursive JSON object.",
  name: "JsonObject",
  parseLiteral(valueNode): JsonObject {
    return parseJsonObjectLiteral(valueNode);
  },
  parseValue(value): JsonObject {
    return parseJsonObjectValue(value);
  },
  serialize(value): JsonObject {
    return parseJsonObjectValue(value);
  },
});

function parseJsonObjectValue(value: unknown): JsonObject {
  try {
    return parseJsonObject(value, "JsonObject");
  } catch {
    throw new GraphQLError("JsonObject must be a JSON object.");
  }
}

function parseJsonObjectLiteral(valueNode: ValueNode): JsonObject {
  if (valueNode.kind !== Kind.OBJECT) {
    throw new GraphQLError("JsonObject literal must be an object.");
  }

  return parseJsonObjectValue(valueFromASTUntyped(valueNode));
}
