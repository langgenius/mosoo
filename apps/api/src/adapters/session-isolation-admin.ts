import { WorkerEntrypoint } from "cloudflare:workers";

import {
  advanceSessionIsolationExecution,
  createSessionIsolationExecutionPlatform,
  inspectSessionIsolationExecution,
  prepareSessionIsolationExecution,
  requestSessionIsolationRollback,
} from "../modules/runtime/infrastructure/session-isolation-execution";
import type { ApiBindings } from "../platform/cloudflare/worker-types";

/** Account-owned service binding only. This entrypoint has no HTTP route. */
export class SessionIsolationAdmin extends WorkerEntrypoint<ApiBindings> {
  prepare(input: unknown) {
    return prepareSessionIsolationExecution(
      this.env.DB,
      createSessionIsolationExecutionPlatform(this.env),
      input,
    );
  }

  inspect(operationId: string) {
    return inspectSessionIsolationExecution(this.env.DB, operationId);
  }

  advance(operationId: string) {
    return advanceSessionIsolationExecution(
      this.env.DB,
      createSessionIsolationExecutionPlatform(this.env),
      operationId,
    );
  }

  rollback(operationId: string) {
    return requestSessionIsolationRollback(this.env.DB, operationId);
  }
}
