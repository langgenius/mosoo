import type { SessionMessageSegment } from "@mosoo/contracts/session";
import { filterOpenAiPrivateCitations } from "agent-driver/provider-output";

export const sanitizeProviderPrivateMarkup = filterOpenAiPrivateCitations;

export function sanitizeAssistantMessageSegments(
  segments: SessionMessageSegment[],
): SessionMessageSegment[] {
  return segments.map((segment) =>
    segment.kind === "text"
      ? {
          ...segment,
          text: sanitizeProviderPrivateMarkup(segment.text).text,
        }
      : segment,
  );
}
