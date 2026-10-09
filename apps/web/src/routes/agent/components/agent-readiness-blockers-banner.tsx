import type { AgentReadiness } from "@mosoo/contracts/agent";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import {
  ADD_PROVIDER_KEY_TEXT,
  PROVIDER_KEY_REQUIRED_TEXT,
  isProviderKeyRequired,
} from "@/domains/vendor-credential/model/provider-readiness-copy";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { ExternalLink } from "@/shared/ui/icons";

export function AgentReadinessBlockersBanner({
  readiness,
  summary,
}: {
  readiness: AgentReadiness;
  summary: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const providerKeyRequired = isProviderKeyRequired(readiness.issues);

  return (
    <div
      className="border-danger/25 bg-danger/[0.05] mb-3 rounded-lg border px-3 py-2.5"
      data-testid="agent-readiness-blockers"
      role="alert"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-danger text-[12px] font-semibold">
            {t(providerKeyRequired ? PROVIDER_KEY_REQUIRED_TEXT : "agent.setupRequired")}
          </div>
          <div className="text-fg-2 mt-1 text-[12px] leading-relaxed">{summary}</div>
        </div>
        {providerKeyRequired ? (
          <Button asChild size="xs" variant="outline">
            <Link to="/providers">
              {t(ADD_PROVIDER_KEY_TEXT)}
              <ExternalLink className="size-3" />
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
