import { describe, expect, test } from "bun:test";

import { SessionPublicEventSocketHub } from "../src/modules/sessions/infrastructure/session/public-event-socket-hub";

class TestPublicEventSocket {
  readonly sent: string[] = [];
  readyState = WebSocket.OPEN;

  deserializeAttachment(): unknown {
    return { role: "public-events", sessionId: "session-1" };
  }

  send(message: string): void {
    this.sent.push(message);
  }
}

describe("SessionPublicEventSocketHub", () => {
  test("notifies every open public event socket", () => {
    const first = new TestPublicEventSocket();
    const second = new TestPublicEventSocket();
    const ctx = {
      getWebSockets: (tag?: string) =>
        tag === "public-events" ? ([first, second] as unknown as WebSocket[]) : ([] as WebSocket[]),
    } as DurableObjectState;
    const hub = new SessionPublicEventSocketHub({
      ctx,
      getSessionId: () => "session-1",
      withSessionLogContext: (fn) => fn(),
    });

    hub.notifyEventsAvailable();

    expect(first.sent).toEqual(["events"]);
    expect(second.sent).toEqual(["events"]);
  });
});
