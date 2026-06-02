import { describe, expect, test } from "bun:test";

import type { AgentSessionActionCapabilityName } from "@mosoo/contracts/session";

import type { ThreadActionCapabilityInput } from "../src/routes/threads/model/session-capabilities";
import { getThreadActionCapabilities } from "../src/routes/threads/model/session-capabilities";

function capability(input: {
  action: AgentSessionActionCapabilityName;
  reason?: string | null;
  status?: ThreadActionCapabilityInput["status"];
}): ThreadActionCapabilityInput {
  return {
    action: input.action,
    reason: input.reason ?? null,
    status: input.status ?? "available",
  };
}

describe("thread action capabilities", () => {
  test("uses send capability for active follow-up", () => {
    const actions = getThreadActionCapabilities({
      bucket: "completed",
      capabilities: [
        capability({
          action: "send_user_message",
          reason: "Session is terminated. Create a new session to continue work.",
          status: "unavailable",
        }),
      ],
    });

    expect(actions.followUp).toEqual({
      action: "send_user_message",
      available: false,
      reason: "Session is terminated. Create a new session to continue work.",
      status: "unavailable",
    });
  });

  test("uses unarchive capability for archived follow-up", () => {
    const actions = getThreadActionCapabilities({
      bucket: "archived",
      capabilities: [
        capability({
          action: "send_user_message",
          reason: "Session is archived and read-only until it is unarchived.",
          status: "unavailable",
        }),
        capability({ action: "unarchive_session" }),
      ],
    });

    expect(actions.followUp).toEqual({
      action: "unarchive_session",
      available: true,
      reason: null,
      status: "available",
    });
  });

  test("mirrors archive and delete capability state", () => {
    const actions = getThreadActionCapabilities({
      bucket: "archived",
      capabilities: [
        capability({
          action: "archive_session",
          reason: "Session is already archived.",
          status: "unavailable",
        }),
        capability({
          action: "delete_session",
          reason: "Only the session creator can mutate this session.",
          status: "unavailable",
        }),
        capability({ action: "unarchive_session" }),
      ],
    });

    expect(actions.archive).toEqual({
      action: "archive_session",
      available: false,
      reason: "Session is already archived.",
      status: "unavailable",
    });
    expect(actions.delete).toEqual({
      action: "delete_session",
      available: false,
      reason: "Only the session creator can mutate this session.",
      status: "unavailable",
    });
  });

  test("keeps mutations disabled until capabilities load", () => {
    const actions = getThreadActionCapabilities({
      bucket: "completed",
      capabilities: null,
    });

    expect(actions.followUp).toEqual({
      action: "send_user_message",
      available: false,
      reason: "Loading session capabilities.",
      status: "unavailable",
    });
  });
});
