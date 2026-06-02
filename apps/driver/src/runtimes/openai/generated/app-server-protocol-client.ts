import { expectRecord, parseThread, parseTurn, readString } from "./app-server-protocol-common";
import type {
  ClientRequestMethod,
  ClientRequestResult,
  InitializeResponse,
  ThreadResumeResponse,
  ThreadStartResponse,
  TurnInterruptResponse,
  TurnStartResponse,
} from "./app-server-protocol-types";

function parseInitializeResponse(value: unknown): InitializeResponse {
  const record = expectRecord(value ?? {}, "initialize result");
  const protocolVersion = readString(record, "protocolVersion");

  return protocolVersion === null ? {} : { protocolVersion };
}

function parseThreadResponse(value: unknown, method: string): ThreadStartResponse {
  const record = expectRecord(value, `${method} result`);

  return {
    thread: parseThread(record["thread"], `${method} result.thread`),
  };
}

function parseTurnStartResponse(value: unknown): TurnStartResponse {
  const record = expectRecord(value, "turn/start result");

  return {
    turn: parseTurn(record["turn"], "turn/start result.turn"),
  };
}

function parseTurnInterruptResponse(value: unknown): TurnInterruptResponse {
  if (value === undefined || value === null) {
    return {};
  }

  const record = expectRecord(value, "turn/interrupt result");
  const turn = record["turn"];

  return turn === undefined ? {} : { turn: parseTurn(turn, "turn/interrupt result.turn") };
}

export const CLIENT_REQUEST_RESULT_PARSERS: {
  [Method in ClientRequestMethod]: (value: unknown) => ClientRequestResult[Method];
} = {
  initialize: parseInitializeResponse,
  "thread/resume": (value: unknown): ThreadResumeResponse =>
    parseThreadResponse(value, "thread/resume"),
  "thread/start": (value: unknown): ThreadStartResponse =>
    parseThreadResponse(value, "thread/start"),
  "turn/interrupt": parseTurnInterruptResponse,
  "turn/start": parseTurnStartResponse,
};

export function parseClientRequestResult(method: "initialize", value: unknown): InitializeResponse;
export function parseClientRequestResult(
  method: "thread/resume",
  value: unknown,
): ThreadResumeResponse;
export function parseClientRequestResult(
  method: "thread/start",
  value: unknown,
): ThreadStartResponse;
export function parseClientRequestResult(
  method: "turn/interrupt",
  value: unknown,
): TurnInterruptResponse;
export function parseClientRequestResult(method: "turn/start", value: unknown): TurnStartResponse;
export function parseClientRequestResult(
  method: ClientRequestMethod,
  value: unknown,
): ClientRequestResult[ClientRequestMethod] {
  return CLIENT_REQUEST_RESULT_PARSERS[method](value);
}
