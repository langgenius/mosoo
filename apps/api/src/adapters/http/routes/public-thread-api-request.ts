import type { PublicThreadApiSendEventsRequest } from "@mosoo/contracts/public-api";
import {
  PUBLIC_THREAD_EVENTS_DEFAULT_LIMIT,
  PUBLIC_THREAD_EVENTS_MAX_LIMIT,
  PUBLIC_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH,
  PUBLIC_THREAD_FILE_ID_MAX_LENGTH,
  PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH,
  PUBLIC_THREAD_JSON_BODY_MAX_BYTES,
} from "@mosoo/contracts/public-api";
import { parsePlatformId } from "@mosoo/id";
import type { AgentId, FileId, PublicThreadId, SessionRunId } from "@mosoo/id";

import {
  PublicApiError,
  publicInvalidRequest,
} from "../../../modules/public-api/public-api-errors";

interface JsonRequestContext {
  req: {
    json: <T>() => Promise<T>;
  };
}

interface RawJsonRequestContext {
  req: {
    raw: Request;
  };
}

const CREATE_THREAD_RESOURCE_FIELDS: ReadonlySet<string> = new Set(["type", "file_id"]);
const CREATE_THREAD_INPUT_FIELDS: ReadonlySet<string> = new Set(["type", "content"]);
const CREATE_THREAD_INPUT_CONTENT_FIELDS: ReadonlySet<string> = new Set(["type", "text"]);
const SEND_EVENTS_REQUEST_FIELDS: ReadonlySet<string> = new Set(["events"]);
const THREAD_EVENT_USER_MESSAGE_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "text",
  "resources",
  "clientRequestId",
]);
const THREAD_EVENT_PERMISSION_DECISION_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "requestId",
  "decision",
]);
const THREAD_EVENT_USER_INTERRUPT_FIELDS: ReadonlySet<string> = new Set(["type", "runId"]);
const CREATE_THREAD_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  "input",
  "resources",
  "client_external_ref",
]);

export interface ParsedCreateThreadRequest {
  clientExternalRef?: string | undefined;
  fileIds: FileId[];
  inputText?: string | undefined;
}

function parseContentLength(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  if (!/^\d+$/.test(value)) {
    throw publicInvalidRequest("Content-Length must be a non-negative integer.");
  }

  const length = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(length)) {
    throw publicInvalidRequest("Content-Length is too large.");
  }

  return length;
}

async function readRequestTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const contentLength = parseContentLength(request.headers.get("content-length"));

  if (contentLength !== null && contentLength > maxBytes) {
    throw publicInvalidRequest(`Request body must be ${maxBytes} bytes or fewer.`);
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  const bodyChunks: string[] = [];

  for (;;) {
    const chunk = await reader.read();

    if (chunk.done) {
      const finalChunk = decoder.decode();

      if (finalChunk.length > 0) {
        bodyChunks.push(finalChunk);
      }

      return bodyChunks.join("");
    }

    bytesRead += chunk.value.byteLength;

    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw publicInvalidRequest(`Request body must be ${maxBytes} bytes or fewer.`);
    }

    bodyChunks.push(decoder.decode(chunk.value, { stream: true }));
  }
}

async function readOptionalJsonBodyWithLimit(
  c: RawJsonRequestContext,
  maxBytes: number,
): Promise<unknown> {
  const body = await readRequestTextWithLimit(c.req.raw, maxBytes);

  if (body.trim().length === 0) {
    return {};
  }

  return JSON.parse(body);
}

export function parseOptionalBoolean(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new PublicApiError({
    code: "invalid_request",
    message: "Boolean query values must be true or false.",
    status: 400,
  });
}

export function parseFileContentDisposition(value: string | undefined): "attachment" | "inline" {
  if (value === undefined) {
    return "attachment";
  }

  if (value === "attachment" || value === "inline") {
    return value;
  }

  throw new PublicApiError({
    code: "invalid_request",
    message: "File content disposition must be attachment or inline.",
    status: 400,
  });
}

export function parseThreadEventsLimit(value: string | undefined): number {
  if (value === undefined) {
    return PUBLIC_THREAD_EVENTS_DEFAULT_LIMIT;
  }

  if (!/^\d+$/.test(value)) {
    throw publicInvalidRequest("limit must be a positive integer.");
  }

  const limit = Number.parseInt(value, 10);

  if (limit < 1 || limit > PUBLIC_THREAD_EVENTS_MAX_LIMIT) {
    throw publicInvalidRequest(`limit must be between 1 and ${PUBLIC_THREAD_EVENTS_MAX_LIMIT}.`);
  }

  return limit;
}

function parsePublicPlatformId(value: string, label: string) {
  try {
    return parsePlatformId(value, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${label} must be a ULID.`;
    throw publicInvalidRequest(message);
  }
}

export function parseAgentIdParam(value: string): AgentId {
  return parsePublicPlatformId(value, "Agent ID") as AgentId;
}

export function parseThreadIdParam(value: string): PublicThreadId {
  return parsePublicPlatformId(value, "Thread ID") as PublicThreadId;
}

export function parseFileIdParam(value: string): FileId {
  return parsePublicPlatformId(value, "File ID") as FileId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw publicInvalidRequest(`${field} is required.`);
  }

  return value;
}

function readLimitedStringField(
  input: Record<string, unknown>,
  field: string,
  maxLength: number,
): string {
  const value = readStringField(input, field);

  if (value.length > maxLength) {
    throw publicInvalidRequest(`${field} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

function assertOnlyFields(
  input: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  context = "request",
): void {
  for (const field of Object.keys(input)) {
    if (!allowedFields.has(field)) {
      throw publicInvalidRequest(`Unsupported ${context} field: ${field}.`);
    }
  }
}

function readOptionalStringOrNull(
  input: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string") {
    return value;
  }

  throw publicInvalidRequest(`${field} must be a string or null.`);
}

function readOptionalLimitedStringField(
  input: Record<string, unknown>,
  field: string,
  maxLength: number,
): string | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw publicInvalidRequest(`${field} must be a non-empty string.`);
  }

  if (value.length > maxLength) {
    throw publicInvalidRequest(`${field} must be ${maxLength} characters or fewer.`);
  }

  return value;
}

function readPublicThreadResourceFileIds(
  input: Record<string, unknown>,
  fieldName: "resources",
): FileId[] | undefined {
  const resources = input[fieldName];

  if (resources === undefined) {
    return undefined;
  }

  if (!Array.isArray(resources)) {
    throw publicInvalidRequest(`${fieldName} must be an array.`);
  }

  const fileIds: FileId[] = [];

  for (const resource of resources) {
    if (!isRecord(resource)) {
      throw publicInvalidRequest(`${fieldName} entries must be objects.`);
    }

    assertOnlyFields(resource, CREATE_THREAD_RESOURCE_FIELDS, "file resource");

    if (resource["type"] !== "file") {
      throw publicInvalidRequest("resource.type must be file.");
    }

    fileIds.push(
      parsePublicPlatformId(
        readLimitedStringField(resource, "file_id", PUBLIC_THREAD_FILE_ID_MAX_LENGTH),
        "file_id",
      ) as FileId,
    );
  }

  return fileIds;
}

function readCreateThreadFileIds(input: Record<string, unknown>): FileId[] {
  return readPublicThreadResourceFileIds(input, "resources") ?? [];
}

function readCreateThreadInputText(input: Record<string, unknown>): string | undefined {
  const rawInput = input["input"];

  if (rawInput === undefined) {
    return undefined;
  }

  if (!isRecord(rawInput)) {
    throw publicInvalidRequest("input must be an object.");
  }

  assertOnlyFields(rawInput, CREATE_THREAD_INPUT_FIELDS, "create thread input");

  if (rawInput["type"] !== "user.message") {
    throw publicInvalidRequest("input.type must be user.message.");
  }

  const content = rawInput["content"];

  if (!Array.isArray(content) || content.length === 0) {
    throw publicInvalidRequest("input.content must be a non-empty array.");
  }

  const texts: string[] = [];

  for (const part of content) {
    if (!isRecord(part)) {
      throw publicInvalidRequest("input.content entries must be objects.");
    }

    assertOnlyFields(part, CREATE_THREAD_INPUT_CONTENT_FIELDS, "create thread input content");

    if (part["type"] !== "text") {
      throw publicInvalidRequest("MVP create thread input only supports text content parts.");
    }

    texts.push(readLimitedStringField(part, "text", PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH));
  }

  const inputText = texts.join("\n").trim();

  if (inputText.length === 0) {
    throw publicInvalidRequest("input text is required.");
  }

  if (inputText.length > PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH) {
    throw publicInvalidRequest(
      `input text must be ${PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH} characters or fewer.`,
    );
  }

  return inputText;
}

function readPublicThreadEvent(input: unknown): PublicThreadApiSendEventsRequest["events"][number] {
  if (!isRecord(input)) {
    throw publicInvalidRequest("Thread event must be an object.");
  }

  switch (input["type"]) {
    case "user_message": {
      assertOnlyFields(input, THREAD_EVENT_USER_MESSAGE_FIELDS, "thread event");
      const event: PublicThreadApiSendEventsRequest["events"][number] = {
        text: readStringField(input, "text"),
        type: "user_message",
      };
      const resourceFileIds = readPublicThreadResourceFileIds(input, "resources");
      const clientRequestId = readOptionalStringOrNull(input, "clientRequestId");

      if (resourceFileIds !== undefined) {
        event.resources = resourceFileIds.map((fileId) => ({
          file_id: fileId,
          type: "file",
        }));
      }

      if (clientRequestId !== undefined) {
        event.clientRequestId = clientRequestId;
      }

      return event;
    }

    case "permission_decision": {
      assertOnlyFields(input, THREAD_EVENT_PERMISSION_DECISION_FIELDS, "thread event");
      const { decision } = input;

      if (decision !== "allow_once" && decision !== "reject_once") {
        throw publicInvalidRequest("decision must be allow_once or reject_once.");
      }

      return {
        decision,
        requestId: readStringField(input, "requestId"),
        type: "permission_decision",
      };
    }

    case "user_interrupt": {
      assertOnlyFields(input, THREAD_EVENT_USER_INTERRUPT_FIELDS, "thread event");
      const event: PublicThreadApiSendEventsRequest["events"][number] = {
        type: "user_interrupt",
      };
      const runId = readOptionalStringOrNull(input, "runId");

      if (runId !== undefined) {
        event.runId =
          runId === null ? null : (parsePublicPlatformId(runId, "runId") as SessionRunId);
      }

      return event;
    }

    default: {
      throw publicInvalidRequest(
        "Thread event type must be user_message, permission_decision, or user_interrupt.",
      );
    }
  }
}

export async function readSendEventsRequest(
  c: JsonRequestContext,
): Promise<PublicThreadApiSendEventsRequest> {
  const body = await c.req.json<unknown>();

  if (!isRecord(body)) {
    throw publicInvalidRequest("Request body must be an object.");
  }

  assertOnlyFields(body, SEND_EVENTS_REQUEST_FIELDS, "send events request");
  const events = body["events"];

  if (!Array.isArray(events) || events.length === 0) {
    throw publicInvalidRequest("events must be a non-empty array.");
  }

  const parsedEvents: PublicThreadApiSendEventsRequest["events"] = [];

  for (const event of events) {
    parsedEvents.push(readPublicThreadEvent(event));
  }

  return {
    events: parsedEvents,
  };
}

export async function readCreateThreadRequest(
  c: RawJsonRequestContext,
): Promise<ParsedCreateThreadRequest> {
  const body = await readOptionalJsonBodyWithLimit(c, PUBLIC_THREAD_JSON_BODY_MAX_BYTES);

  if (!isRecord(body)) {
    throw publicInvalidRequest("Request body must be an object.");
  }

  assertOnlyFields(body, CREATE_THREAD_REQUEST_FIELDS, "create thread");
  const clientExternalRef = readOptionalLimitedStringField(
    body,
    "client_external_ref",
    PUBLIC_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH,
  );
  const inputText = readCreateThreadInputText(body);

  return {
    fileIds: readCreateThreadFileIds(body),
    ...(inputText === undefined ? {} : { inputText }),
    ...(clientExternalRef === undefined ? {} : { clientExternalRef }),
  };
}
