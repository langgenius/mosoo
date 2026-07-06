import { printSchema } from "graphql";
import { createSchema } from "graphql-yoga";

import { graphqlModuleSpecs } from "./graphql-module-specs.ts";

interface CodegenGraphQLModuleSpec {
  mutationFields?: readonly string[];
  queryFields?: readonly string[];
  typeDefs?: string;
}

const codegenGraphQLModuleSpecs: readonly CodegenGraphQLModuleSpec[] = graphqlModuleSpecs;

function collectCodegenFields(key: "mutationFields" | "queryFields"): string[] {
  return codegenGraphQLModuleSpecs.flatMap((module) => module[key] ?? []);
}

const typeDefs = codegenGraphQLModuleSpecs.flatMap((module) => module.typeDefs ?? []);

const codegenTypeDefs = `
  ${typeDefs.join("\n")}

  type Query {
    ${collectCodegenFields("queryFields").join("\n    ")}
  }

  type Mutation {
    ${collectCodegenFields("mutationFields").join("\n    ")}
  }
`;

const schema = printSchema(
  createSchema({
    typeDefs: codegenTypeDefs,
  }),
);

export { schema };
export default schema;
