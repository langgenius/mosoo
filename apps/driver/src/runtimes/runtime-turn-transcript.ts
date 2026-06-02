import { createPlatformId } from "@mosoo/id";
import type { SessionMessageId } from "@mosoo/id";

export class RuntimeAssistantMessageIdIndex<TKey extends string> {
  readonly #messageIds = new Map<TKey, SessionMessageId>();

  getOrCreate(key: TKey): SessionMessageId {
    const existing = this.#messageIds.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const messageId = createPlatformId<SessionMessageId>();
    this.#messageIds.set(key, messageId);
    return messageId;
  }

  reset(): void {
    this.#messageIds.clear();
  }
}
