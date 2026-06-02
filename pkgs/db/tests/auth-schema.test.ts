import { describe, expect, test } from "bun:test";

import { authAccountsTable, authSessionsTable } from "../src/schema/auth.schema";

describe("auth DB schema", () => {
  test("maps Better Auth account identifiers to their canonical columns", () => {
    expect(authAccountsTable.accountId.name).toBe("provider_account_id");
    expect(authAccountsTable.userId.name).toBe("account_id");
    expect(authSessionsTable.userId.name).toBe("account_id");
  });
});
