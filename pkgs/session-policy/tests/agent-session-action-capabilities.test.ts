import { describe, expect, test } from "bun:test";

import type {
  AgentSessionActionCapabilityName,
  AgentSessionActionCapabilityStatus,
} from "@mosoo/contracts/session";
import {
  getAgentSessionActionCapability,
  getAgentSessionActionCapabilities,
  getAvailableAgentSessionActionCapability,
} from "@mosoo/session-policy";

function expectCapability(input: {
  action: AgentSessionActionCapabilityName;
  archivedAt?: string | null;
  reason?: string | null;
  runtimeId?: string;
  status?: AgentSessionActionCapabilityStatus;
  sessionStatus?: "IDLE" | "TERMINATED";
}) {
  const expected: {
    reason?: string | null;
    status: AgentSessionActionCapabilityStatus;
  } = {
    status: input.status ?? "available",
  };

  if (input.reason !== undefined) {
    expected.reason = input.reason;
  }

  expect(
    getAgentSessionActionCapability({
      action: input.action,
      archivedAt: input.archivedAt ?? null,
      runtimeId: input.runtimeId ?? "openai-runtime",
      status: input.sessionStatus ?? "IDLE",
    }),
  ).toMatchObject(expected);
}

describe("agent session action capabilities", () => {
  test("makes runtime actions available on a supported runtime", () => {
    expectCapability({ action: "send_user_message", reason: null });
    expectCapability({ action: "connect_stream", reason: null });
    expectCapability({ action: "permission_decision", reason: null });
    expectCapability({ action: "user_interrupt", reason: null });
    expectCapability({ action: "unarchive_session", status: "unavailable" });
  });

  test("keeps runtime-free actions available when the runtime is not supported", () => {
    expectCapability({ action: "retrieve_session", reason: null, runtimeId: "retired-runtime" });
    expectCapability({ action: "delete_session", reason: null, runtimeId: "retired-runtime" });
    expectCapability({
      action: "send_user_message",
      reason: "Runtime is not supported.",
      runtimeId: "retired-runtime",
      status: "unavailable",
    });
    expectCapability({
      action: "user_interrupt",
      reason: "Runtime is not supported.",
      runtimeId: "retired-runtime",
      status: "unavailable",
    });
  });

  test("session state gates mutation actions without hiding read actions", () => {
    const capabilities = new Map(
      getAgentSessionActionCapabilities({
        archivedAt: "2026-06-01T00:00:00.000Z",
        runtimeId: "openai-runtime",
        status: "IDLE",
      }).map((capability) => [capability.action, capability]),
    );

    expect(capabilities.get("send_user_message")).toMatchObject({
      status: "unavailable",
    });
    expect(capabilities.get("permission_decision")).toMatchObject({
      status: "unavailable",
    });
    expect(capabilities.get("archive_session")).toMatchObject({
      status: "unavailable",
    });
    expect(capabilities.get("delete_session")).toMatchObject({
      reason: null,
      status: "available",
    });
    expect(capabilities.get("unarchive_session")).toMatchObject({
      reason: null,
      status: "available",
    });
    expect(capabilities.get("retrieve_session")).toMatchObject({
      reason: null,
      status: "available",
    });
  });

  test("terminal lifecycle keeps delete separate from archive read-only semantics", () => {
    const capabilities = new Map(
      getAgentSessionActionCapabilities({
        archivedAt: "2026-06-01T00:00:00.000Z",
        runtimeId: "openai-runtime",
        status: "TERMINATED",
      }).map((capability) => [capability.action, capability]),
    );

    expect(capabilities.get("send_user_message")).toMatchObject({
      status: "unavailable",
    });
    expect(capabilities.get("archive_session")).toMatchObject({
      status: "unavailable",
    });
    expect(capabilities.get("unarchive_session")).toMatchObject({
      status: "unavailable",
    });
    expect(capabilities.get("delete_session")).toMatchObject({
      reason: null,
      status: "available",
    });
  });

  test("available capability lookup rejects unavailable actions", () => {
    expect(() =>
      getAvailableAgentSessionActionCapability({
        action: "send_user_message",
        runtimeId: "system-agent",
        status: "IDLE",
      }),
    ).toThrow();
  });
});
