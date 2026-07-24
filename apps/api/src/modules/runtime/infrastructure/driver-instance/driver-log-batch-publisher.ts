import type { DriverLogBatchInput } from "@mosoo/agent-driver/orpc";

import { createApiChildLogger, runWithApiLogContext } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../../shared/truthiness";
import { runtimeSessionLinkNeedsRefresh } from "./event-types";
import { getRuntimeSessionLink } from "./events";
import type { DriverInstanceRuntimeState } from "./runtime-state";

export async function publishDriverLogBatch(
  env: ApiBindings,
  state: DriverInstanceRuntimeState,
  input: DriverLogBatchInput,
): Promise<void> {
  const driverInstanceId = state.requireDriverInstanceId();
  const cachedLink = state.runtimeSessionLink;
  const link =
    cachedLink !== null && !runtimeSessionLinkNeedsRefresh(cachedLink)
      ? cachedLink
      : await getRuntimeSessionLink(env.DB, driverInstanceId);
  state.setRuntimeSessionLink(link);

  for (const entry of input.logs) {
    const logger = createApiChildLogger(
      isTruthy(entry.namespace) ? `driver.${entry.namespace}` : "driver",
    );

    runWithApiLogContext(
      {
        ...(isTruthy(link.traceId) ? { traceId: link.traceId } : {}),
        ...(isTruthy(state.traceId) ? { traceId: state.traceId } : {}),
        ...entry.context,
        driverInstanceId,
        ...(isTruthy(link.sessionRunId) ? { sessionRunId: link.sessionRunId } : {}),
      },
      () => {
        const metadata = {
          ...entry.fields,
          driverTimestamp: entry.timestamp,
          ...(entry.error ? { error: entry.error } : {}),
        };

        switch (entry.level) {
          case "trace":
          case "debug": {
            logger.debug(entry.message, metadata);
            return;
          }
          case "warn": {
            logger.warn(entry.message, metadata);
            return;
          }
          case "error": {
            logger.error(entry.message, metadata);
            return;
          }
          case "info": {
            logger.info(entry.message, metadata);
            return;
          }
          default: {
            logger.info(entry.message, metadata);
            return;
          }
        }
      },
    );
  }
}
