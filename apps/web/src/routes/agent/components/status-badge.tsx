import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { Badge } from "@/shared/ui/badge";

import type { AgentStatus } from "../agent.types";

const STATUS_LABEL_KEYS: Record<AgentStatus, string> = {
  draft: "agent.draft",
  published: "agent.published",
};

const STATUS_STYLES: Record<AgentStatus, { variant: "default" | "primary" }> = {
  draft: { variant: "default" },
  published: { variant: "primary" },
};

export function StatusBadge({ status }: { status: AgentStatus }): ReactElement {
  const { t } = useTranslation();
  const style = STATUS_STYLES[status];
  return <Badge variant={style.variant}>{t(STATUS_LABEL_KEYS[status])}</Badge>;
}
