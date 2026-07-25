import { enqueueScheduledMaintenanceCommand } from "../../modules/api-command/application/api-command-enqueue";
import { redriveFailedApiCommandEnqueues } from "../../modules/api-command/application/api-command-ledger";
import type { ApiCommandMessage } from "../../modules/api-command/application/api-command-message";
import {
  processApiCommandDeadLetterMessage,
  processApiCommandMessage,
} from "../../modules/api-command/application/api-command-processor";
import type { ChannelFinalDeliveryMessage } from "../../modules/channels/application/channel-final-delivery-message";
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
      await enqueueScheduledMaintenanceCommand(env, {
        scheduledTime: controller.scheduledTime,
      });
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

      if (isQueue("channel-final-delivery")) {
        const { processChannelFinalDeliveryMessage } =
          await import("../../modules/channels/application/channel-final-delivery.service");
        const channelBatch = batch as MessageBatch<ChannelFinalDeliveryMessage>;

        for (const message of channelBatch.messages) {
          await processChannelFinalDeliveryMessage(env, message);
        }
      }
    },
  } satisfies ExportedHandler<ApiBindings>;
}
