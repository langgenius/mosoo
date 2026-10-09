import { printSchema } from "graphql";
import { createSchema } from "graphql-yoga";

import { graphqlTypeDefs } from "./graphql-module-specs.ts";

const schema = printSchema(
  createSchema({
    typeDefs: graphqlTypeDefs,
  }),
);

export { schema };
export default schema;
