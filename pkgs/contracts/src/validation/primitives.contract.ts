import { type } from "arktype";

type SchemaParseError = InstanceType<typeof type.errors>;
type SchemaParser<Output> = (value: unknown) => Output | SchemaParseError;

export function parseSchemaValue<Output>(schema: SchemaParser<Output>, value: unknown): Output {
  const parsed = schema(value);

  if (parsed instanceof type.errors) {
    throw new TypeError(parsed.summary);
  }

  return parsed;
}

export const NonEmptyString = type("string > 0");
export type NonEmptyString = typeof NonEmptyString.infer;

export const PrimitiveValue = type("string | number | boolean | null");
export type PrimitiveValue = typeof PrimitiveValue.infer;

export const PrimitiveRecord = type({
  "[string]": PrimitiveValue,
});
export type PrimitiveRecord = typeof PrimitiveRecord.infer;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertJsonValue(entry, `${label}[${index}]`);
    });
    return;
  }

  if (isJsonObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, `${label}.${key}`);
    }
    return;
  }

  throw new TypeError(`${label} must be JSON-serializable.`);
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
    );
  }

  return value;
}

export function parseJsonObject(value: unknown, label = "JsonObject"): JsonObject {
  if (!isJsonObject(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  assertJsonValue(value, label);
  return cloneJsonValue(value) as JsonObject;
}
