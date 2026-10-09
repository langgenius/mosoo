import { describe, expect, spyOn, test } from "bun:test";

import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";

import { dispatchSessionRun } from "../src/modules/runtime/application/session-runs/dispatch-run.service";
import { createRuntimeTimingRecorder } from "../src/modules/runtime/application/session-runs/session-runtime-timing";
import * as driverSession from "../src/modules/runtime/infrastructure/driver-session.service";
import * as executionPlane from "../src/modules/runtime/infrastructure/execution-plane/sandbox-execution-plane-adapter";
import type { RuntimeExecutionPlaneRunLease } from "../src/modules/runtime/infrastructure/execution-plane/sandbox-execution-plane-adapter";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  insertSessionRunFixture,
} from "./helpers/public-api-http-test-fixture";

const RUN_ID = PUBLIC_API_TEST_IDS.run as SessionRunId;
const SESSION_ID = PUBLIC_API_TEST_IDS.ownerSession as SessionId;

async function dispatchWithReadinessFailures(closedBeforeReadyFailures: number) {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  await insertSessionRunFixture(database, { id: RUN_ID, sessionId: SESSION_ID, status: "queued" });
  const timing = createRuntimeTimingRecorder({
    runId: RUN_ID,
    sessionId: SESSION_ID,
    source: "api",
    stage: "prepare_run",
    traceId: null,
  }).snapshot();
  let readinessFailures = closedBeforeReadyFailures;
  const prepareRun = spyOn(executionPlane, "prepareRun").mockImplementation(
    async (): Promise<RuntimeExecutionPlaneRunLease> => ({
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      readiness: async () => {
        if (readinessFailures > 0) {
          readinessFailures -= 1;
          throw new Error(
            `Driver instance ${PUBLIC_API_TEST_IDS.driverOwner} closed before ready.`,
          );
        }

        return timing;
      },
      release: () => {},
      timing,
    }),
  );
  const dispatchTurn = spyOn(driverSession, "dispatchDriverTurn").mockResolvedValue(undefined);

  try {
    const dispatch = dispatchSessionRun(
      createPublicHttpTestBindings(database) as ApiBindings,
      "https://api.example.com/api/graphql",
      {
        attachmentIds: [],
        builtInTools: [],
        profile: { runtimeId: "openai-runtime", sandbox: { id: PUBLIC_API_TEST_IDS.sandbox } },
        prompt: "Retry a driver that closed before ready.",
        resolvedMcpServers: [],
        resolvedSkillCatalog: [],
        resolvedSkills: [],
        sessionId: SESSION_ID,
        sessionRunId: RUN_ID,
        traceId: "trace-pre-ready-retry",
      } as unknown as Parameters<typeof dispatchSessionRun>[2],
    ).then(
      () => null,
      (error: unknown) => error,
    );
    const error = await dispatch;
    const run = await database
      .prepare("SELECT status, error_code FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ error_code: string | null; status: string }>();

    return { attempts: prepareRun.mock.calls.length, error, run };
  } finally {
    prepareRun.mockRestore();
    dispatchTurn.mockRestore();
  }
}

describe("dispatchSessionRun pre-ready retry", () => {
  test("retries once when the driver closes before ready", async () => {
    const result = await dispatchWithReadinessFailures(1);

    expect(result.error).toBeNull();
    expect(result.attempts).toBe(2);
    expect(result.run).toEqual({ error_code: null, status: "booting" });
  });

  test("fails the run when the retry also closes before ready", async () => {
    const result = await dispatchWithReadinessFailures(2);

    expect(result.error).toBeInstanceOf(Error);
    expect(result.attempts).toBe(2);
    expect(result.run).toEqual({ error_code: "runtime.provision_failed", status: "failed" });
  });
});
