import type { AgentReadiness } from "@mosoo/contracts/agent";
import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import {
  ADD_PROVIDER_KEY_TEXT,
  RETRY_PROVIDER_CHECK_TEXT,
  formatReadinessIssueMessages,
  getPrimaryProviderReadinessPresentation,
} from "@/domains/vendor-credential/model/provider-readiness-copy";
import { Button } from "@/shared/ui/button";

function readinessBlockMessages(readiness: AgentReadiness | null): string[] {
  return readiness ? formatReadinessIssueMessages(readiness.issues) : [];
}

export function AgentReadinessBlockersBanner({
  onRetryProviderCheck,
  readiness,
  retrying,
  summary,
}: {
  onRetryProviderCheck?: () => void;
  readiness: AgentReadiness;
  retrying?: boolean;
  summary: string | null;
}): ReactElement {
  const messages = readinessBlockMessages(readiness);
  const providerPresentation = getPrimaryProviderReadinessPresentation(readiness.issues);
  const isRetrying = retrying === true;
  const hasSummary = summary !== null && summary !== "";

  return (
    <div
      className="border-destructive/20 bg-destructive/[0.04] border-b px-4 py-3"
      data-testid="agent-readiness-blockers"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-destructive text-[12px] font-semibold">
            {providerPresentation?.title ?? "Setup required"}
          </div>
          {hasSummary ? (
            <div className="text-fg-2 mt-1 text-[12px] leading-relaxed">{summary}</div>
          ) : null}
        </div>
        {providerPresentation?.action === "add-provider-key" ? (
          <Button asChild size="xs" variant="outline">
            <Link to="/providers">
              {ADD_PROVIDER_KEY_TEXT}
              <ExternalLink className="size-3" />
            </Link>
          </Button>
        ) : null}
        {providerPresentation?.action === "retry-provider-check" &&
        onRetryProviderCheck !== undefined ? (
          <Button
            disabled={isRetrying}
            onClick={onRetryProviderCheck}
            size="xs"
            type="button"
            variant="outline"
          >
            {isRetrying ? "Retrying..." : RETRY_PROVIDER_CHECK_TEXT}
          </Button>
        ) : null}
      </div>
      {messages.length > 0 ? (
        <ul className="text-fg-2 mt-2 space-y-1 text-[12px] leading-relaxed">
          {messages.map((message) => (
            <li key={message} className="flex gap-2">
              <span aria-hidden className="bg-destructive mt-[0.55em] size-1 rounded-full" />
              <span>{message}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
