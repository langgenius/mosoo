export interface SessionResourceMention {
  id: string;
  name: string;
  path: string;
}

export type DraftSessionResourceMentions = Record<string, SessionResourceMention[]>;

function uniqueMentions(mentions: SessionResourceMention[]): SessionResourceMention[] {
  const seen = new Set<string>();
  const unique: SessionResourceMention[] = [];

  for (const mention of mentions) {
    if (seen.has(mention.path)) {
      continue;
    }

    seen.add(mention.path);
    unique.push(mention);
  }

  return unique;
}

export function appendSessionResourceMentionsToMessage(
  message: string,
  mentions: SessionResourceMention[],
): string {
  // Reference the file by its plain sandbox-relative path. The agent runtime does
  // not resolve "@" mentions, so prefixing one would be passed to the model verbatim
  // and treated as a literal path ("@session-files/...") that does not exist on disk,
  // forcing the agent to hunt for the real "session-files/..." path. See YEF-713.
  const paths = uniqueMentions(mentions).map((mention) => mention.path);

  if (paths.length === 0) {
    return message;
  }

  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    return paths.join("\n");
  }

  return `${trimmedMessage}\n\n${paths.join("\n")}`;
}

export function appendDraftSessionResourceMention(
  draftMentions: DraftSessionResourceMentions,
  sessionId: string,
  mention: SessionResourceMention,
): DraftSessionResourceMentions {
  return {
    ...draftMentions,
    [sessionId]: uniqueMentions([mention, ...(draftMentions[sessionId] ?? [])]),
  };
}

export function clearDraftSessionResourceMentions(
  draftMentions: DraftSessionResourceMentions,
  sessionId: string,
): DraftSessionResourceMentions {
  const { [sessionId]: _clearedMentions, ...remainingMentions } = draftMentions;
  return remainingMentions;
}
