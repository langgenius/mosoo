import type { RuntimeCommand, RuntimeCommandInput, RuntimeCommandResult } from "@mosoo/contracts";

import {
  digestText,
  summarizeOrganizationAccessSnapshot,
  summarizeTextDigest,
} from "./driver-debug-paths";

export function summarizeRuntimeCommandInput(input: RuntimeCommandInput): Record<string, unknown> {
  const attachmentIds = [...(input.attachmentIds ?? [])].toSorted();

  return {
    attachmentCount: attachmentIds.length,
    attachmentFingerprint: attachmentIds.length > 0 ? digestText(attachmentIds.join("\n")) : null,
    text: summarizeTextDigest(input.text),
  };
}

export function summarizeRuntimeCommand(command: RuntimeCommand): Record<string, unknown> {
  const base = {
    commandId: command.commandId,
    kind: command.kind,
  };

  switch (command.kind) {
    case "input.start": {
      return {
        ...base,
        input: summarizeRuntimeCommandInput(command.input),
        organizationAccessSnapshot: command.organizationAccessSnapshot
          ? summarizeOrganizationAccessSnapshot(command.organizationAccessSnapshot)
          : null,
        requestId: command.requestId,
        runId: command.runId,
      };
    }
    case "access.refresh": {
      return {
        ...base,
        organizationAccessSnapshot: summarizeOrganizationAccessSnapshot(
          command.organizationAccessSnapshot,
        ),
      };
    }
    case "mcp.execute": {
      return {
        ...base,
        arguments: summarizeTextDigest(command.argumentsJson),
        requestId: command.requestId,
        serverId: command.serverId,
        toolName: command.toolName,
      };
    }
    case "permission.resolve": {
      return {
        ...base,
        decision: command.decision,
        requestId: command.requestId,
      };
    }
    case "turn.cancel":
    case "session.stop": {
      return {
        ...base,
        reason: "reason" in command ? (command.reason ?? null) : null,
      };
    }
    default: {
      return base;
    }
  }
}

export function summarizeRuntimeCommandResult(
  result: RuntimeCommandResult | undefined,
): Record<string, unknown> | null {
  if (result === undefined || result === null) {
    return null;
  }

  if ("entryCount" in result) {
    return {
      entryCount: result.entryCount,
      kind: "organization_access_snapshot",
    };
  }

  if ("outputText" in result) {
    return {
      kind: "mcp_execute",
      outputText: summarizeTextDigest(result.outputText),
      requestId: result.requestId,
      serverId: result.serverId,
      toolName: result.toolName,
    };
  }

  if ("requestId" in result) {
    return {
      kind: "input_start",
      requestId: result.requestId,
    };
  }

  return {
    kind: "unknown",
  };
}

export function summarizeDriverPermissionRequest(input: {
  rawInput: string | null;
  requestId: string;
  title: string;
  toolCallId: string | null;
  toolKind: string | null;
}): Record<string, unknown> {
  return {
    rawInput: summarizeTextDigest(input.rawInput),
    requestId: input.requestId,
    title: summarizeTextDigest(input.title),
    toolCallIdPresent: input.toolCallId !== null,
    toolKind: input.toolKind,
  };
}
