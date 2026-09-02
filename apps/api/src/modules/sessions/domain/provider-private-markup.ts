import {
  filterOpenAiPrivateCitations,
  OpenAiPrivateCitationStreamFilter,
} from "@mosoo/agent-driver/provider-output";
import type { SessionMessageSegment } from "@mosoo/contracts/session";

export const sanitizeProviderPrivateMarkup = filterOpenAiPrivateCitations;
export { OpenAiPrivateCitationStreamFilter as ProviderPrivateMarkupStreamFilter };

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
