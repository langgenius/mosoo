import type { DriverEventInput } from "@mosoo/driver-protocol";
import type { SessionRunId } from "@mosoo/id";

import { toRuntimeToolStatus, toToolCallPayload } from "./acp-tool-events";
import {
  isRecord,
  readNonEmptyString,
  readRecord,
  readString,
  stringifyForDisplay,
} from "./acp-types";
import type { JsonObject } from "./acp-types";

export interface AcpPermissionTranslation {
  readonly defaultOptionId: string | null;
  readonly events: DriverEventInput[];
  readonly options: readonly AcpPermissionOption[];
  readonly requestId: string;
  readonly targetItemId: string;
  readonly title: string;
  readonly toolCall: JsonObject | null;
}

export interface AcpPermissionOption {
  readonly kind: string;
  readonly name: string;
  readonly optionId: string;
}

export function toAcpPermissionRequest(input: {
  params: unknown;
  requestId: string;
  runId: SessionRunId | null;
}): AcpPermissionTranslation {
  const params = isRecord(input.params) ? input.params : {};
  const toolCall = readRecord(params, "toolCall");
  const options = normalizePermissionOptions(params["options"]);
  const toolCallId = readNonEmptyString(toolCall, "toolCallId") ?? input.requestId;
  const title =
    readNonEmptyString(toolCall, "title") ??
    readNonEmptyString(toolCall, "kind") ??
    "Allow tool call?";
  const events: DriverEventInput[] = [];

  if (toolCall !== null) {
    events.push({
      kind: "tool.call.updated",
      payload: toToolCallPayload(
        toolCallId,
        toRuntimeToolStatus(readString(toolCall, "status")),
        toolCall,
      ),
      ...(input.runId === null ? {} : { runId: input.runId }),
    });
  }

  events.push({
    kind: "permission.requested",
    payload: {
      defaultOptionId: options.find((option) => option.kind === "allow_once")?.optionId ?? null,
      details: stringifyForDisplay(toolCall?.["rawInput"]),
      options,
      requestId: input.requestId,
      targetItemId: toolCallId,
      title,
      toolCall: toolCall === null ? null : toToolCallPayload(toolCallId, "running", toolCall),
    },
    ...(input.runId === null ? {} : { runId: input.runId }),
  });

  return {
    defaultOptionId: options.find((option) => option.kind === "allow_once")?.optionId ?? null,
    events,
    options,
    requestId: input.requestId,
    targetItemId: toolCallId,
    title,
    toolCall,
  };
}

export function toAcpPermissionResolvedEvent(input: {
  option: AcpPermissionOption | null;
  requestId: string;
  runId: SessionRunId | null;
}): DriverEventInput {
  return {
    kind: "permission.resolved",
    payload:
      input.option === null
        ? {
            outcome: "cancelled",
            requestId: input.requestId,
          }
        : {
            optionId: input.option.optionId,
            optionKind: input.option.kind,
            outcome: "selected",
            requestId: input.requestId,
          },
    ...(input.runId === null ? {} : { runId: input.runId }),
  };
}

function normalizePermissionOptions(raw: unknown): AcpPermissionOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((entry): AcpPermissionOption[] => {
    if (!isRecord(entry)) {
      return [];
    }

    const optionId = readNonEmptyString(entry, "optionId");
    const name = readNonEmptyString(entry, "name");
    const kind = readNonEmptyString(entry, "kind");

    if (optionId === null || name === null || kind === null) {
      return [];
    }

    return [{ kind, name, optionId }];
  });
}
