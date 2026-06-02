import type {
  CreatePublishedThreadFileRequest,
  PublishedAgentSendEventsRequest,
} from "@mosoo/contracts/public-api";
import {
  PUBLISHED_THREAD_EVENTS_DEFAULT_LIMIT,
  PUBLISHED_THREAD_EVENTS_MAX_LIMIT,
  PUBLISHED_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH,
  PUBLISHED_THREAD_FILE_ID_MAX_LENGTH,
  PUBLISHED_THREAD_INPUT_TEXT_MAX_LENGTH,
  PUBLISHED_THREAD_JSON_BODY_MAX_BYTES,
} from "@mosoo/contracts/public-api";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, FileId, PublicThreadId, SessionRunId } from "@mosoo/id";

import {
  PublishedAgentApiError,
  publicInvalidRequest,
} from "../../../modules/public-api/published-agent-api-errors";

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

const CREATE_THREAD_FILE_FIELDS: ReadonlySet<string> = new Set(["file_id"]);
const CREATE_THREAD_INPUT_FIELDS: ReadonlySet<string> = new Set(["type", "content"]);
const CREATE_THREAD_INPUT_CONTENT_FIELDS: ReadonlySet<string> = new Set(["type", "text"]);
const SEND_EVENTS_REQUEST_FIELDS: ReadonlySet<string> = new Set(["events"]);
const THREAD_EVENT_USER_MESSAGE_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "text",
  "attachmentIds",
  "clientRequestId",
]);
const THREAD_EVENT_PERMISSION_DECISION_FIELDS: ReadonlySet<string> = new Set([
  "type",
  "requestId",
  "decision",
]);
const THREAD_EVENT_USER_INTERRUPT_FIELDS: ReadonlySet<string> = new Set(["type", "runId"]);
const THREAD_FILE_REQUEST_FIELDS: ReadonlySet<string> = new Set(["fileId"]);
const CREATE_THREAD_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  "input",
  "files",
  "attributed_user_id",
  "client_external_ref",
]);

export interface ParsedCreateThreadRequest {
  attributedUserId?: AccountId | undefined;
  clientExternalRef?: string | undefined;
  fileIds: FileId[];
  inputText: string;
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

async function readJsonBodyWithLimit(c: RawJsonRequestContext, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readRequestTextWithLimit(c.req.raw, maxBytes));
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

  throw new PublishedAgentApiError({
    code: "invalid_request",
    message: "Boolean query values must be true or false.",
    status: 400,
  });
}

export function parseThreadEventsLimit(value: string | undefined): number {
  if (value === undefined) {
    return PUBLISHED_THREAD_EVENTS_DEFAULT_LIMIT;
  }

  if (!/^\d+$/.test(value)) {
    throw publicInvalidRequest("limit must be a positive integer.");
  }

  const limit = Number.parseInt(value, 10);

  if (limit < 1 || limit > PUBLISHED_THREAD_EVENTS_MAX_LIMIT) {
    throw publicInvalidRequest(`limit must be between 1 and ${PUBLISHED_THREAD_EVENTS_MAX_LIMIT}.`);
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

function readOptionalStringArray(
  input: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw publicInvalidRequest(`${field} must be an array of strings.`);
  }

  return value;
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

function readCreateThreadFileIds(input: Record<string, unknown>): FileId[] {
  const files = input["files"];

  if (files === undefined) {
    return [];
  }

  if (!Array.isArray(files)) {
    throw publicInvalidRequest("files must be an array.");
  }

  const fileIds: FileId[] = [];

  for (const file of files) {
    if (!isRecord(file)) {
      throw publicInvalidRequest("files entries must be objects.");
    }

    assertOnlyFields(file, CREATE_THREAD_FILE_FIELDS, "create thread file");
    fileIds.push(
      parsePublicPlatformId(
        readLimitedStringField(file, "file_id", PUBLISHED_THREAD_FILE_ID_MAX_LENGTH),
        "file_id",
      ) as FileId,
    );
  }

  return fileIds;
}

function readCreateThreadInputText(input: Record<string, unknown>): string {
  const rawInput = input["input"];

  if (!isRecord(rawInput)) {
    throw publicInvalidRequest("input is required.");
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

    texts.push(readLimitedStringField(part, "text", PUBLISHED_THREAD_INPUT_TEXT_MAX_LENGTH));
  }

  const inputText = texts.join("\n").trim();

  if (inputText.length === 0) {
    throw publicInvalidRequest("input text is required.");
  }

  if (inputText.length > PUBLISHED_THREAD_INPUT_TEXT_MAX_LENGTH) {
    throw publicInvalidRequest(
      `input text must be ${PUBLISHED_THREAD_INPUT_TEXT_MAX_LENGTH} characters or fewer.`,
    );
  }

  return inputText;
}

function readPublishedThreadEvent(
  input: unknown,
): PublishedAgentSendEventsRequest["events"][number] {
  if (!isRecord(input)) {
    throw publicInvalidRequest("Thread event must be an object.");
  }

  switch (input["type"]) {
    case "user_message": {
      assertOnlyFields(input, THREAD_EVENT_USER_MESSAGE_FIELDS, "thread event");
      const event: PublishedAgentSendEventsRequest["events"][number] = {
        text: readStringField(input, "text"),
        type: "user_message",
      };
      const attachmentIds = readOptionalStringArray(input, "attachmentIds");
      const clientRequestId = readOptionalStringOrNull(input, "clientRequestId");

      if (attachmentIds !== undefined) {
        event.attachmentIds = attachmentIds.map(
          (attachmentId) => parsePublicPlatformId(attachmentId, "attachmentIds entry") as FileId,
        );
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
      const event: PublishedAgentSendEventsRequest["events"][number] = {
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
): Promise<PublishedAgentSendEventsRequest> {
  const body = await c.req.json<unknown>();

  if (!isRecord(body)) {
    throw publicInvalidRequest("Request body must be an object.");
  }

  assertOnlyFields(body, SEND_EVENTS_REQUEST_FIELDS, "send events request");
  const events = body["events"];

  if (!Array.isArray(events) || events.length === 0) {
    throw publicInvalidRequest("events must be a non-empty array.");
  }

  const parsedEvents: PublishedAgentSendEventsRequest["events"] = [];

  for (const event of events) {
    parsedEvents.push(readPublishedThreadEvent(event));
  }

  return {
    events: parsedEvents,
  };
}

export async function readCreateThreadFileRequest(
  c: RawJsonRequestContext,
): Promise<CreatePublishedThreadFileRequest> {
  const body = await readJsonBodyWithLimit(c, PUBLISHED_THREAD_JSON_BODY_MAX_BYTES);

  if (!isRecord(body)) {
    throw publicInvalidRequest("Request body must be an object.");
  }

  assertOnlyFields(body, THREAD_FILE_REQUEST_FIELDS, "thread file request");

  return {
    fileId: parsePublicPlatformId(
      readLimitedStringField(body, "fileId", PUBLISHED_THREAD_FILE_ID_MAX_LENGTH),
      "fileId",
    ) as FileId,
  };
}

export async function readCreateThreadRequest(
  c: RawJsonRequestContext,
): Promise<ParsedCreateThreadRequest> {
  const body = await readJsonBodyWithLimit(c, PUBLISHED_THREAD_JSON_BODY_MAX_BYTES);

  if (!isRecord(body)) {
    throw publicInvalidRequest("Request body must be an object.");
  }

  assertOnlyFields(body, CREATE_THREAD_REQUEST_FIELDS, "create thread");
  const attributedUserIdInput = readOptionalLimitedStringField(body, "attributed_user_id", 26);
  const clientExternalRef = readOptionalLimitedStringField(
    body,
    "client_external_ref",
    PUBLISHED_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH,
  );

  return {
    fileIds: readCreateThreadFileIds(body),
    inputText: readCreateThreadInputText(body),
    ...(attributedUserIdInput === undefined
      ? {}
      : {
          attributedUserId: parsePublicPlatformId(
            attributedUserIdInput,
            "attributed_user_id",
          ) as AccountId,
        }),
    ...(clientExternalRef === undefined ? {} : { clientExternalRef }),
  };
}
