import { redriveFailedApiCommandEnqueues } from "../../modules/api-command/application/api-command-ledger";
import type { ApiCommandMessage } from "../../modules/api-command/application/api-command-message";
import {
  processApiCommandDeadLetterMessage,
  processApiCommandMessage,
} from "../../modules/api-command/application/api-command-processor";
import { runUsageDailyRollup } from "../../modules/cost/application/cost-rollup.service";
import { cleanupPublicApiIdempotencyKeys } from "../../modules/public-api/public-api-idempotency.service";
import { cleanupPublicApiRateLimitWindows } from "../../modules/public-api/public-api-rate-limit.service";
import { runSandboxMaintenance } from "../../modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-maintenance.service";
import { createErrorLogContext, logError } from "./logger";
import type { ApiBindings } from "./worker-types";

interface ApiHttpApp {
  fetch(request: Request, env: ApiBindings, ctx: ExecutionContext): Response | Promise<Response>;
}

let httpAppPromise: Promise<ApiHttpApp> | null = null;

function getHttpApp(): Promise<ApiHttpApp> {
  httpAppPromise ??= import("../../adapters/http/create-http-app").then(({ createHttpApp }) =>
    createHttpApp(),
  );

  return httpAppPromise;
}

export function createApiWorker(): ExportedHandler<ApiBindings> {
  return {
    async fetch(request: Request, env: ApiBindings, ctx: ExecutionContext): Promise<Response> {
      const app = await getHttpApp();
      const response = await app.fetch(request, env, ctx);

      return response;
    },
    async scheduled(controller: ScheduledController, env: ApiBindings): Promise<void> {
      await redriveFailedApiCommandEnqueues(env);
      await runSandboxMaintenance(env);
      // Expired public API receipts and rate-limit windows; the next minute retries a failure.
      await Promise.all([
        cleanupPublicApiIdempotencyKeys(env.DB),
        cleanupPublicApiRateLimitWindows(env.DB),
      ]).catch((error: unknown) => {
        logError("public-api.cleanup_failed", createErrorLogContext(error));
      });

      // The rollup aggregates every row older than its cutoff, so a failed day
      // is caught up by the next one.
      const scheduledAt = new Date(controller.scheduledTime);
      if (scheduledAt.getUTCHours() === 2 && scheduledAt.getUTCMinutes() === 0) {
        await runUsageDailyRollup(env, scheduledAt).catch((error: unknown) => {
          logError("cost.usage_daily_rollup_failed", createErrorLogContext(error));
        });
      }
    },
    async queue(batch: MessageBatch, env: ApiBindings): Promise<void> {
      // Queue names are account-global, so isolated environments (the perf
      // stacks) deploy prefixed copies like "mosoo-perf-stage-b-api-command".
      // Route by suffix so a renamed queue still reaches its consumer instead
      // of silently acking every batch unprocessed.
      const isQueue = (name: string): boolean =>
        batch.queue === name || batch.queue.endsWith(`-${name}`);

      if (isQueue("api-command-dlq")) {
        const commandBatch = batch as MessageBatch<ApiCommandMessage>;

        for (const message of commandBatch.messages) {
          await processApiCommandDeadLetterMessage(env, message);
        }

        return;
      }

      if (isQueue("api-command") || isQueue("environment-artifact-build")) {
        const commandBatch = batch as MessageBatch<ApiCommandMessage>;

        for (const message of commandBatch.messages) {
          await processApiCommandMessage(env, message);
        }

        return;
      }

      throw new Error(`No consumer for queue ${batch.queue}.`);
    },
  } satisfies ExportedHandler<ApiBindings>;
}
