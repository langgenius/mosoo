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
