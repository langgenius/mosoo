import { useState } from "react";

import { isTruthy } from "../../shared/lib/truthiness";
import {
  appendDraftSessionResourceMention,
  clearDraftSessionResourceMentions,
} from "./session-resource-mentions";
import type {
  DraftSessionResourceMentions,
  SessionResourceMention,
} from "./session-resource-mentions";
export function useSessionResourceDraft(activeSessionId: string | null): {
  appendMention: (sessionId: string, mention: SessionResourceMention) => void;
  clearActiveMentions: () => void;
  mentions: SessionResourceMention[];
} {
  const [draftResourceMentionsBySession, setDraftResourceMentionsBySession] =
    useState<DraftSessionResourceMentions>({});
  const mentions = isTruthy(activeSessionId)
    ? (draftResourceMentionsBySession[activeSessionId] ?? [])
    : [];

  return {
    appendMention: (sessionId, mention) => {
      setDraftResourceMentionsBySession((current) =>
        appendDraftSessionResourceMention(current, sessionId, mention),
      );
    },
    clearActiveMentions: () => {
      if (!isTruthy(activeSessionId)) {
        return;
      }

      setDraftResourceMentionsBySession((current) =>
        clearDraftSessionResourceMentions(current, activeSessionId),
      );
    },
    mentions,
  };
}
