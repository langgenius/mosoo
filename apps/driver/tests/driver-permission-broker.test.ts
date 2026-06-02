import { describe, expect, test } from "bun:test";

import type { DriverEventInput } from "@mosoo/driver-protocol";

import { DriverPermissionBroker } from "../src/core/driver-permission-broker";
import type { DriverInstanceSocket } from "../src/infrastructure/runtime/driver-instance-socket";

interface RecordingSocket extends DriverInstanceSocket {
  readonly pushedEvents: DriverEventInput[];
}

function createRecordingSocket(): RecordingSocket {
  const pushedEvents: DriverEventInput[] = [];

  return {
    pushedEvents,
    pushEvents: async (input) => {
      pushedEvents.push(...input.events);
    },
  } as RecordingSocket;
}

describe("DriverPermissionBroker", () => {
  test("emits canonical permission events and waits for the platform decision", async () => {
    const broker = new DriverPermissionBroker(() => null);
    const socket = createRecordingSocket();

    const request = broker.request(socket, {
      rawInput: '{"command":"fd ."}',
      requestId: "permission-1",
      title: "Approve command execution",
      toolCallId: "tool-1",
      toolKind: "bash",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(socket.pushedEvents).toMatchObject([
      {
        kind: "permission.requested",
        payload: {
          details: '{"command":"fd ."}',
          requestId: "permission-1",
          targetItemId: "tool-1",
          title: "Approve command execution",
        },
      },
    ]);

    expect(broker.resolve("permission-1", "allow_once")).toBe(true);
    await expect(request).resolves.toBe("allow_once");

    expect(socket.pushedEvents).toMatchObject([
      {
        kind: "permission.requested",
      },
      {
        kind: "permission.resolved",
        payload: {
          outcome: "allow_once",
          permissionRequests: [],
          requestId: "permission-1",
        },
      },
    ]);
  });

  test("rejects unsupported interactive permission requests instead of allowing them", async () => {
    const broker = new DriverPermissionBroker(() => null, { interactiveRequests: false });
    const socket = createRecordingSocket();

    await expect(
      broker.request(socket, {
        rawInput: '{"command":"fd ."}',
        requestId: "permission-1",
        title: "Approve command execution",
        toolCallId: "tool-1",
        toolKind: "bash",
      }),
    ).resolves.toBe("reject_once");

    expect(broker.capabilityStatus()).toBe("unsupported");
    expect(socket.pushedEvents).toEqual([]);
  });
});
