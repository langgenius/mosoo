import type { ReactElement } from "react";

import { Badge } from "@/shared/ui/badge";

import type { AgentStatus } from "../agent.types";

const STATUS_STYLES: Record<AgentStatus, { label: string; variant: "default" | "primary" }> = {
  draft: { label: "Draft", variant: "default" },
  published: { label: "Published", variant: "primary" },
};

export function StatusBadge({ status }: { status: AgentStatus }): ReactElement {
  const style = STATUS_STYLES[status];
  return <Badge variant={style.variant}>{style.label}</Badge>;
}
