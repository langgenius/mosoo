import { isRecord, readString } from "./agent-sdk-json";

export function readClaudeSdkSessionId(value: unknown): string | null {
  const record = isRecord(value) ? value : null;
  return readString(record, "session_id");
}

export function isDuplicateClaudeFinalText(
  streamedTextByMessageId: ReadonlyMap<string, string>,
  messageId: string,
  text: string,
): boolean {
  const sameMessageText = streamedTextByMessageId.get(messageId);

  if (sameMessageText === text) {
    return true;
  }

  for (const streamedText of streamedTextByMessageId.values()) {
    if (streamedText === text) {
      return true;
    }
  }

  return false;
}
