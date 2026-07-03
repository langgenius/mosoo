import { Loader2 } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";

import type { DeploymentRunDisplayStatus } from "../deploy-console-data";

type StatusKind = "live" | "progress" | "failed" | "idle";

interface StatusDescriptor {
  kind: StatusKind;
  label: string;
}

const PROGRESS_LABELS: Record<string, string> = {
  activating: "Activating",
  building: "Building",
  preparing: "Preparing",
  queued: "Queued",
  submitted: "Submitted",
  submitting: "Submitting",
};

function describeStatus(status: DeploymentRunDisplayStatus): StatusDescriptor {
  if (status === "success") {
    return { kind: "live", label: "Live" };
  }
  if (status === "failed") {
    return { kind: "failed", label: "Failed" };
  }
  if (status === "superseded") {
    return { kind: "idle", label: "Superseded" };
  }
  return { kind: "progress", label: `${PROGRESS_LABELS[status] ?? status}…` };
}

function withScope(label: string, scopeLabel: string | undefined): string {
  if (scopeLabel === undefined) {
    return label;
  }

  return `${scopeLabel} ${label.slice(0, 1).toLowerCase()}${label.slice(1)}`;
}

export function StatusBadge({
  scopeLabel,
  status,
}: {
  scopeLabel?: string | undefined;
  status: DeploymentRunDisplayStatus;
}) {
  const { kind, label } = describeStatus(status);
  const scopedLabel = withScope(label, scopeLabel);

  if (kind === "idle") {
    return <span className="text-fg-3 text-[12.5px] font-medium">{scopedLabel}</span>;
  }

  if (kind === "progress") {
    return (
      <Badge variant="warning">
        <Loader2 className="size-3 animate-spin" />
        {scopedLabel}
      </Badge>
    );
  }

  if (kind === "failed") {
    return <Badge variant="danger">{scopedLabel}</Badge>;
  }

  return (
    <Badge variant="success">
      <span
        className={cn("size-1.5 rounded-full bg-current")}
        style={{ animation: "pulse 900ms cubic-bezier(0.4,0,0.6,1) infinite" }}
        aria-hidden
      />
      {scopedLabel}
    </Badge>
  );
}
