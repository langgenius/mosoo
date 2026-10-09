import { describe, expect, test } from "bun:test";

import { getActiveSessionRunSummary } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
  insertSessionRunFixture,
} from "./helpers/public-api-http-test-fixture";

const ACTIVE_PROBE_LATEST_RUN_ID = "01J0000000000000000000R002";
const ACTIVE_PROBE_OLD_RUN_ID = "01J0000000000000000000R003";

describe("session run reads", () => {
  test("loads the latest active run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionRunFixture(database, {
      createdAt: 1,
      id: ACTIVE_PROBE_OLD_RUN_ID,
      status: "queued",
    });
    await insertSessionRunFixture(database, {
      createdAt: 2,
      id: ACTIVE_PROBE_LATEST_RUN_ID,
      status: "queued",
    });

    await expect(
      getActiveSessionRunSummary(database, "01J0000000000000000000000B"),
    ).resolves.toMatchObject({ id: ACTIVE_PROBE_LATEST_RUN_ID, status: "queued" });
  });
});
