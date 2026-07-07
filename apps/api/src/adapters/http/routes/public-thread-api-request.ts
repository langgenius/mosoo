import type {
  CreatePublicThreadFileUploadRequest,
  CreatePublicThreadFileRequest,
  PublicThreadApiSendEventsRequest,
} from "@mosoo/contracts/public-api";
import {
  PUBLIC_THREAD_EVENTS_DEFAULT_LIMIT,
  PUBLIC_THREAD_EVENTS_MAX_LIMIT,
  PUBLIC_THREAD_CLIENT_EXTERNAL_REF_MAX_LENGTH,
  PUBLIC_THREAD_FILE_ID_MAX_LENGTH,
  PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES,
  PUBLIC_THREAD_INPUT_TEXT_MAX_LENGTH,
  PUBLIC_THREAD_JSON_BODY_MAX_BYTES,
} from "@mosoo/contracts/public-api";
import { parsePlatformId } from "@mosoo/id";
import type { AgentId, FileId, PublicThreadId, SessionRunId } from "@mosoo/id";

import {
  PublicApiError,
  publicInvalidRequest,
} from "../../../modules/public-api/public-api-errors";
import { hashPublicApiIdempotencyBody } from "../../../modules/public-api/public-api-idempotency.service";

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
const THREAD_FILE_UPLOAD_REQUEST_FIELDS: ReadonlySet<string> = new Set(["file"]);
const THREAD_FILE_UPLOAD_FILE_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "contentType",
  "size",
]);
const CREATE_THREAD_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  "input",
  "files",
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

async function readJsonBodyWithLimit(c: RawJsonRequestContext, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readRequestTextWithLimit(c.req.raw, maxBytes));
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

/**
 * Path-segment shape shared by App slugs and exposed Agent names (PRD "API
 * Namespace & Access"). Mirrors the native validator's URL-safety gate
 * (`native.agent.name_not_url_safe`) and the minted slug alphabet in
 * modules/apps/domain/app-slug.ts: lowercase kebab starting with a letter or
 * digit, at most 64 characters. Values inside the shape that match nothing
 * resolve to publicNotFound at the service level.
 */
const APP_NAMESPACE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseAppSlugParam(value: string): string {
  if (!APP_NAMESPACE_SEGMENT_PATTERN.test(value)) {
    throw publicInvalidRequest(
      "App slug must be a lowercase kebab-case path segment of at most 64 characters.",
    );
  }

  return value;
}

export function parseAgentNameParam(value: string): string {
  if (!APP_NAMESPACE_SEGMENT_PATTERN.test(value)) {
    throw publicInvalidRequest(
      "Agent name must be a lowercase kebab-case path segment of at most 64 characters.",
    );
  }

  return value;
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

function readSafeIntegerField(input: Record<string, unknown>, field: string): number {
  const value = input[field];

  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw publicInvalidRequest(`${field} must be an integer.`);
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
        readLimitedStringField(file, "file_id", PUBLIC_THREAD_FILE_ID_MAX_LENGTH),
        "file_id",
      ) as FileId,
    );
  }

  return fileIds;
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

export async function readCreateThreadFileRequest(
  c: RawJsonRequestContext,
): Promise<CreatePublicThreadFileRequest> {
  const body = await readJsonBodyWithLimit(c, PUBLIC_THREAD_JSON_BODY_MAX_BYTES);

  if (!isRecord(body)) {
    throw publicInvalidRequest("Request body must be an object.");
  }

  assertOnlyFields(body, THREAD_FILE_REQUEST_FIELDS, "thread file request");

  return {
    fileId: parsePublicPlatformId(
      readLimitedStringField(body, "fileId", PUBLIC_THREAD_FILE_ID_MAX_LENGTH),
      "fileId",
    ) as FileId,
  };
}

export async function readCreateThreadFileUploadRequest(
  c: RawJsonRequestContext,
): Promise<CreatePublicThreadFileUploadRequest> {
  const body = await readJsonBodyWithLimit(c, PUBLIC_THREAD_JSON_BODY_MAX_BYTES);

  if (!isRecord(body)) {
    throw publicInvalidRequest("Request body must be an object.");
  }

  assertOnlyFields(body, THREAD_FILE_UPLOAD_REQUEST_FIELDS, "thread file upload request");
  const file = body["file"];

  if (!isRecord(file)) {
    throw publicInvalidRequest("file must be an object.");
  }

  assertOnlyFields(file, THREAD_FILE_UPLOAD_FILE_FIELDS, "thread file upload file");
  const size = readSafeIntegerField(file, "size");

  if (size < 0) {
    throw publicInvalidRequest("file.size must be a non-negative integer.");
  }

  if (size > PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES) {
    throw publicInvalidRequest(
      `file.size must be ${PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES} bytes or fewer.`,
    );
  }

  return {
    file: {
      contentType: readStringField(file, "contentType"),
      name: readStringField(file, "name"),
      size,
    },
  };
}

/**
 * Read and JSON-parse the bound-agent call body under the shared public-API
 * body-size cap. The bound endpoint is keyless and internet-facing, so it must
 * refuse oversized bodies the same way every PAT thread route does instead of
 * buffering an unbounded request into the isolate.
 */
export async function readBoundAgentCallRequestBody(c: RawJsonRequestContext): Promise<unknown> {
  return readJsonBodyWithLimit(c, PUBLIC_THREAD_JSON_BODY_MAX_BYTES);
}

/**
 * Canonical idempotency projection of a parsed create-thread body. Shared by
 * the ULID route and the name-addressed App namespace route so both surfaces
 * hash identical requests identically.
 */
export async function hashCreateThreadIdempotencyBody(
  body: ParsedCreateThreadRequest,
): Promise<string | null> {
  return hashPublicApiIdempotencyBody({
    clientExternalRef: body.clientExternalRef ?? null,
    fileIds: body.fileIds,
    inputText: body.inputText ?? null,
  });
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
