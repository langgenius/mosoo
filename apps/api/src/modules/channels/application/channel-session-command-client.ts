import type { ChannelThreadSessionId } from "@mosoo/db";

import { logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  createAgentSession,
  sendAgentSessionEvents,
} from "../../runtime/application/session-run.service";
import type { ChannelSessionTriggeredByMetadata } from "../../runtime/application/session-runs/create-agent-session.service";
import { recordAgentChannelBindingError } from "./agent-channel-binding-error";
import {
  beginChannelEventReceipt,
  clearChannelEventReceipt,
  completeChannelEventReceipt,
  hasProcessedChannelEvent,
} from "./channel-event-receipt-store";
import { getSessionRunReply } from "./channel-session-reply";
import type {
  AgentChannelBindingContext,
  ChannelSessionCommandClient,
  ChannelWorkTrigger,
} from "./channel-session.types";
import {
  claimChannelThreadSession,
  clearChannelThreadSessionReservation,
  completeChannelThreadSessionReservation,
  findExistingChannelSession,
} from "./channel-thread-session-store";

interface ChannelTriggeredByMetadata extends ChannelSessionTriggeredByMetadata {
  binding_id: string;
  event_id: string;
  external_actor_id: string;
  external_message_id: string;
  external_thread_id: string;
  external_workspace_id: string;
  provider: AgentChannelBindingContext["provider"];
  provider_metadata: AgentChannelBindingContext["displayMetadata"];
}

function toTriggeredByMetadata(
  binding: AgentChannelBindingContext,
  trigger: ChannelWorkTrigger,
): ChannelTriggeredByMetadata {
  const externalWorkspaceId = trigger.externalWorkspaceId?.trim() || binding.externalTenantId;

  return {
    binding_id: binding.bindingId,
    event_id: trigger.eventId,
    external_actor_id: trigger.externalActorId,
    external_message_id: trigger.externalMessageId,
    external_thread_id: trigger.externalThreadId,
    external_workspace_id: externalWorkspaceId,
    provider: binding.provider,
    provider_metadata: {
      ...binding.displayMetadata,
      ...trigger.providerMetadata,
    },
  };
}

export function createChannelSessionClient(input: {
  binding: AgentChannelBindingContext;
  bindings: ApiBindings;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  requestUrl: string;
}): ChannelSessionCommandClient {
  return {
    async createOrContinueSession(command) {
      const clientRequestId = command.clientRequestId.trim();
      const receipt = await beginChannelEventReceipt({
        bindingId: input.binding.bindingId,
        database: input.bindings.DB,
        externalEventId: clientRequestId,
        externalTenantId: input.binding.externalTenantId,
        provider: input.binding.provider,
      });

      if (receipt.duplicate) {
        return { duplicate: true, runId: null, sessionId: receipt.sessionId };
      }

      let threadReservationId: ChannelThreadSessionId | null = null;

      try {
        const threadSession = command.trigger.requiresExistingSession
          ? {
              reservationId: null,
              sessionId: await findExistingChannelSession({
                agentId: input.binding.agentId,
                bindingId: input.binding.bindingId,
                database: input.bindings.DB,
                externalThreadId: command.trigger.externalThreadId,
                provider: input.binding.provider,
              }),
            }
          : await claimChannelThreadSession({
              agentId: input.binding.agentId,
              bindingId: input.binding.bindingId,
              database: input.bindings.DB,
              externalThreadId: command.trigger.externalThreadId,
              provider: input.binding.provider,
            });

        threadReservationId = threadSession.reservationId;

        if (command.trigger.requiresExistingSession && !threadSession.sessionId) {
          logInfo("channel-events.thread_reply_ignored", {
            agentId: input.binding.agentId,
            bindingId: input.binding.bindingId,
            eventId: command.trigger.eventId,
            provider: input.binding.provider,
            reason: "orphan_thread",
            threadId: command.trigger.externalThreadId,
          });
          await clearChannelEventReceipt({
            database: input.bindings.DB,
            receiptId: receipt.receiptId,
          });
          return { duplicate: false, ignored: true, runId: null, sessionId: null };
        }

        const sessionId =
          threadSession.sessionId ??
          (
            await createAgentSession({
              bindings: input.bindings,
              executionContext: input.executionContext,
              input: {
                agentId: input.binding.agentId,
                type: "api_channel",
              },
              options: {
                accessViewer: input.binding.owner,
                attributedUserId: null,
                auditActor: {
                  display: command.trigger.auditActorDisplay,
                  id: input.binding.bindingId,
                  metadata: {
                    binding_id: input.binding.bindingId,
                    event_id: command.trigger.eventId,
                    external_actor_id: command.trigger.auditActorId,
                    provider: input.binding.provider,
                  },
                  type: "system",
                },
                metadata: {
                  triggered_by: toTriggeredByMetadata(input.binding, command.trigger),
                },
              },
              viewer: input.binding.owner,
            })
          ).id;

        await completeChannelThreadSessionReservation({
          database: input.bindings.DB,
          reservationId: threadReservationId,
          sessionId,
        });
        threadReservationId = null;

        if (
          clientRequestId.length > 0 &&
          (await hasProcessedChannelEvent({
            clientRequestId,
            database: input.bindings.DB,
            sessionId,
          }))
        ) {
          await completeChannelEventReceipt({
            database: input.bindings.DB,
            receiptId: receipt.receiptId,
            sessionId,
          });
          return { duplicate: true, runId: null, sessionId };
        }

        const eventBatch = await sendAgentSessionEvents({
          bindings: input.bindings,
          executionContext: input.executionContext,
          input: {
            events: [
              {
                attachmentIds: [],
                clientRequestId,
                text: command.text,
                type: "user_message",
              },
            ],
            sessionId,
          },
          options: {
            accessViewer: input.binding.owner,
          },
          requestUrl: input.requestUrl,
          viewer: input.binding.owner,
        });
        const runId =
          eventBatch.events.find((event) => event.type === "user_message")?.run?.id ?? null;

        if (!runId) {
          throw new Error("Channel session command did not start a run.");
        }

        await completeChannelEventReceipt({
          database: input.bindings.DB,
          receiptId: receipt.receiptId,
          sessionId,
        });

        return { duplicate: false, ignored: false, runId, sessionId };
      } catch (error) {
        await clearChannelEventReceipt({
          database: input.bindings.DB,
          receiptId: receipt.receiptId,
        });
        await clearChannelThreadSessionReservation({
          database: input.bindings.DB,
          reservationId: threadReservationId,
        });
        throw error;
      }
    },
    async markBindingError(errorCode) {
      await recordAgentChannelBindingError(input.bindings.DB, {
        agentId: input.binding.agentId,
        bindingId: input.binding.bindingId,
        errorCode,
        provider: input.binding.provider,
      });
    },
    retrieveSessionReply(sessionId, runId) {
      return getSessionRunReply(input.bindings.DB, { runId, sessionId });
    },
  };
}
