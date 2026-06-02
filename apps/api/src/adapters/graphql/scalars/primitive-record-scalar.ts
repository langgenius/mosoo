import {
  PrimitiveRecord as PrimitiveRecordSchema,
  parseSchemaValue,
} from "@mosoo/contracts/validation";
import { GraphQLError, GraphQLScalarType, Kind } from "graphql";
import type { ValueNode } from "graphql";

export const primitiveRecordScalar = new GraphQLScalarType({
  description: "A JSON object whose values must be primitive scalars or null.",
  name: "PrimitiveRecord",
  parseLiteral(valueNode): Record<string, string | number | boolean | null> {
    return parsePrimitiveRecordLiteral(valueNode);
  },
  parseValue(value): Record<string, string | number | boolean | null> {
    return parsePrimitiveRecordValue(value);
  },
  serialize(value): Record<string, string | number | boolean | null> {
    return parsePrimitiveRecordValue(value);
  },
});

function parsePrimitiveRecordValue(
  value: unknown,
): Record<string, string | number | boolean | null> {
  try {
    return parseSchemaValue(PrimitiveRecordSchema, value);
  } catch {
    throw new GraphQLError("PrimitiveRecord must be an object with primitive values.");
  }
}

function parsePrimitiveRecordLiteral(
  valueNode: ValueNode,
): Record<string, string | number | boolean | null> {
  if (valueNode.kind !== Kind.OBJECT) {
    throw new GraphQLError("PrimitiveRecord literal must be an object.");
  }

  const value = Object.create(null) as Record<string, string | number | boolean | null>;

  for (const field of valueNode.fields) {
    value[field.name.value] = parsePrimitiveValueLiteral(field.value);
  }

  return parsePrimitiveRecordValue(value);
}

function parsePrimitiveValueLiteral(valueNode: ValueNode): string | number | boolean | null {
  switch (valueNode.kind) {
    case Kind.BOOLEAN: {
      return valueNode.value;
    }
    case Kind.FLOAT:
    case Kind.INT: {
      return Number(valueNode.value);
    }
    case Kind.NULL: {
      return null;
    }
    case Kind.STRING: {
      return valueNode.value;
    }
    case Kind.VARIABLE:
    case Kind.ENUM:
    case Kind.LIST:
    case Kind.OBJECT: {
      throw new GraphQLError("PrimitiveRecord values must be primitive GraphQL literals.");
    }
    default: {
      throw new GraphQLError("PrimitiveRecord values must be primitive GraphQL literals.");
    }
  }
}
