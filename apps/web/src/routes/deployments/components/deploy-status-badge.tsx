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

export function StatusBadge({ status }: { status: DeploymentRunDisplayStatus }) {
  const { kind, label } = describeStatus(status);

  if (kind === "idle") {
    return <span className="text-fg-3 text-[12.5px] font-medium">{label}</span>;
  }

  if (kind === "progress") {
    return (
      <Badge variant="warning">
        <Loader2 className="size-3 animate-spin" />
        {label}
      </Badge>
    );
  }

  if (kind === "failed") {
    return <Badge variant="danger">{label}</Badge>;
  }

  return (
    <Badge variant="success">
      <span
        className={cn("size-1.5 rounded-full bg-current")}
        style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }}
        aria-hidden
      />
      {label}
    </Badge>
  );
}
