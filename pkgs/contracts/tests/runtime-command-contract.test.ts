import { describe, expect, test } from "bun:test";

import { McpExecuteCommandResult, RuntimeCommand } from "../src/runtime/runtime-command.contract";

describe("runtime command run ownership", () => {
  test.each([
    { commandId: "cancel", kind: "turn.cancel" },
    {
      argumentsJson: "{}",
      commandId: "mcp",
      kind: "mcp.execute",
      requestId: "request",
      serverId: "server",
      toolCallId: "call",
      toolName: "tool",
    },
    {
      commandId: "permission",
      decision: "allow_once",
      kind: "permission.resolve",
      requestId: "request",
    },
  ])("requires an explicit run for $kind", (command) => {
    expect(RuntimeCommand.allows(command)).toBe(false);
    expect(RuntimeCommand.allows({ ...command, runId: "" })).toBe(false);
    expect(RuntimeCommand.allows({ ...command, runId: "run-1" })).toBe(true);
  });

  test("keeps session stop scoped to the driver session", () => {
    expect(
      RuntimeCommand.allows({
        commandId: "stop",
        kind: "session.stop",
        reason: "shutdown",
      }),
    ).toBe(true);
  });

  test("validates the durable MCP tool error result", () => {
    const result = {
      isError: true,
      outputText: "tool failed",
      requestId: "request",
      serverId: "server",
      toolName: "tool",
    };

    expect(McpExecuteCommandResult.allows(result)).toBe(true);
    expect(McpExecuteCommandResult.allows({ ...result, isError: "true" })).toBe(false);
  });
});
