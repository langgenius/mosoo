import { SESSION_RUN_STATUSES, SESSION_RUN_TRIGGERS } from "@mosoo/contracts/session-run";

import { graphQLEnumValues } from "./graphql-enum-values";

export const commonSchema = /* GraphQL */ `
  scalar JsonObject
  scalar PrimitiveRecord
  scalar ULID

  type OperationResult {
    ok: Boolean!
  }

  type RunError {
    code: String!
    details: PrimitiveRecord!
    message: String!
    retryable: Boolean!
  }

  type UserWarning {
    code: String!
    message: String!
  }

  enum RunStatus {
    ${graphQLEnumValues(SESSION_RUN_STATUSES)}
  }

  enum SessionRunTrigger {
    ${graphQLEnumValues(SESSION_RUN_TRIGGERS)}
  }
`;
