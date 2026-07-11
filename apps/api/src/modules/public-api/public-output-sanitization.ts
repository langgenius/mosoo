import type { PublicThreadFinalOutputWarning } from "@mosoo/contracts/public-api";

import { sanitizeProviderPrivateMarkup } from "../sessions/domain/provider-private-markup";

export interface SanitizedPublicOutput {
  readonly text: string;
  readonly warnings: PublicThreadFinalOutputWarning[];
}

export function sanitizePublicOutput(text: string): SanitizedPublicOutput {
  const sanitized = sanitizeProviderPrivateMarkup(text);

  return {
    text: sanitized.text,
    warnings:
      sanitized.privateCitationCount === 0
        ? []
        : [
            {
              code: "unresolved_provider_citation",
              count: sanitized.privateCitationCount,
            },
          ],
  };
}
