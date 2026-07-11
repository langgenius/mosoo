import { Check, Loader2 } from "lucide-react";

import { Badge } from "@/shared/ui/badge";

import type { DeploymentRunOutcome } from "../deployment-status";

function withScope(label: string, scopeLabel: string | undefined): string {
  if (scopeLabel === undefined) {
    return label;
  }

  return `${scopeLabel} ${label.slice(0, 1).toLowerCase()}${label.slice(1)}`;
}

export function StatusBadge({
  outcome,
  scopeLabel,
}: {
  outcome: DeploymentRunOutcome;
  scopeLabel?: string | undefined;
}) {
  const label =
    outcome === "deploying" ? "Deploying…" : outcome === "failed" ? "Failed" : "Successful";
  const scopedLabel = withScope(label, scopeLabel);

  if (outcome === "deploying") {
    return (
      <Badge variant="warning">
        <Loader2 className="size-3 animate-spin" />
        {scopedLabel}
      </Badge>
    );
  }

  if (outcome === "failed") {
    return <Badge variant="danger">{scopedLabel}</Badge>;
  }

  return (
    <Badge variant="success">
      <Check className="size-3" />
      {scopedLabel}
    </Badge>
  );
}
