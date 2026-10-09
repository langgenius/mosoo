import { GraphQLScalarType } from "graphql";

// Output-only: RunError.details is shaped by the session-run contract.
export const primitiveRecordScalar = new GraphQLScalarType({
  description: "A JSON object whose values must be primitive scalars or null.",
  name: "PrimitiveRecord",
});
