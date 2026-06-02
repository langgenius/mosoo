import type { ApiCommandMessage } from "../../src/modules/api-command/application/api-command-message";
import type { ChannelFinalDeliveryMessage } from "../../src/modules/channels/application/channel-final-delivery-message";

const TEST_MESSAGE_TIME_MS = Date.parse("2026-05-08T00:00:00.000Z");

export interface CapturedApiCommandMessage {
  body: ApiCommandMessage;
  contentType: string;
  delaySeconds: number | null;
  id: string;
}

export interface CapturedChannelFinalDeliveryMessage {
  body: ChannelFinalDeliveryMessage;
  contentType: string;
  delaySeconds: number | null;
  id: string;
}

export interface ApiCommandQueueStub {
  readonly sent: CapturedApiCommandMessage[];
  send(
    body: ApiCommandMessage,
    options?: { contentType?: string; delaySeconds?: number },
  ): Promise<void>;
}

export interface ChannelFinalDeliveryQueueStub {
  readonly sent: CapturedChannelFinalDeliveryMessage[];
  send(
    body: ChannelFinalDeliveryMessage,
    options?: { contentType?: string; delaySeconds?: number },
  ): Promise<void>;
}

export function createApiCommandQueueStub(): ApiCommandQueueStub {
  const sent: CapturedApiCommandMessage[] = [];

  return {
    sent,
    async send(body, options): Promise<void> {
      sent.push({
        body,
        contentType: options?.contentType ?? "json",
        delaySeconds: options?.delaySeconds ?? null,
        id: `queued-${sent.length + 1}`,
      });
    },
  };
}

export function createChannelFinalDeliveryQueueStub(): ChannelFinalDeliveryQueueStub {
  const sent: CapturedChannelFinalDeliveryMessage[] = [];

  return {
    sent,
    async send(body, options): Promise<void> {
      sent.push({
        body,
        contentType: options?.contentType ?? "json",
        delaySeconds: options?.delaySeconds ?? null,
        id: `queued-${sent.length + 1}`,
      });
    },
  };
}

export interface RecordedQueueMessageAction {
  type: "ack" | "retry";
  delaySeconds?: number;
}

export interface RecordedQueueMessage<T> {
  body: T;
  recorded: RecordedQueueMessageAction[];
  message: Message<T>;
}

export function createRecordedQueueMessage<T>(input: {
  body: T;
  id?: string;
}): RecordedQueueMessage<T> {
  const recorded: RecordedQueueMessageAction[] = [];
  const message: Message<T> = {
    ack: () => {
      recorded.push({ type: "ack" });
    },
    attempts: recorded.length,
    body: input.body,
    id: input.id ?? "queued-test",
    retry: (options) => {
      recorded.push({ delaySeconds: options?.delaySeconds, type: "retry" });
    },
    timestamp: new Date(TEST_MESSAGE_TIME_MS),
  };

  return { body: input.body, message, recorded };
}
