import type { AgentResolutionIssue } from "@mosoo/contracts/agent-manifest";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";
import { Badge } from "@/shared/ui/badge";

const TARGET_TYPE_LABEL_KEYS: Record<AgentResolutionIssue["targetType"], string> = {
  agent: "agent.agent",
  environment: "agent.environment",
  mcp_server: "agent.mcpServer",
  model: "agent.model",
  provider: "agent.provider",
  runtime: "agent.runtime",
  skill: "skills.skill",
};

function formatIssueTarget(issue: AgentResolutionIssue, t: (key: string) => string): string {
  const target = issue.targetLabel === null ? "" : ` · ${issue.targetLabel}`;
  return `${t(TARGET_TYPE_LABEL_KEYS[issue.targetType])}${target}`;
}

function formatIssueStatus(issue: AgentResolutionIssue): string {
  return issue.status.replaceAll("_", " ");
}

function getIssueActionLabel(issue: AgentResolutionIssue): string {
  if (issue.actionLabel !== null) {
    return issue.actionLabel;
  }

  if (issue.targetType === "runtime") {
    return "Choose runtime";
  }
  if (issue.targetType === "model") {
    return "Choose model";
  }
  if (issue.targetType === "provider") {
    return "Configure key";
  }
  if (issue.targetType === "mcp_server") {
    return "Connect MCP";
  }
  if (issue.targetType === "environment") {
    return "Choose environment";
  }
  if (issue.targetType === "skill") {
    return "Replace or remove skill";
  }
  return "Review item";
}

function getIssueActionLink(issue: AgentResolutionIssue): string | null {
  if (
    issue.targetType === "mcp_server" &&
    (issue.status === "needs_reconnect" || issue.status === "missing")
  ) {
    return "#agent-mcp-bindings";
  }

  return null;
}

export function PackageResolutionIssueCard({
  issue,
  requiredTone = "muted",
}: {
  issue: AgentResolutionIssue;
  requiredTone?: "amber" | "muted";
}): ReactElement {
  const { t } = useTranslation();
  const actionLabel = getIssueActionLabel(issue);
  const actionLink = getIssueActionLink(issue);

  return (
    <div className="bg-card/70 rounded-md px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="t-group-label">{formatIssueTarget(issue, t)}</div>
          <div className="text-foreground mt-0.5 text-[12px] font-medium">{issue.message}</div>
        </div>
        <Badge variant={issue.required && requiredTone === "amber" ? "warning" : "default"}>
          {issue.required ? t("agent.required") : t("onboarding.optional")}
        </Badge>
      </div>
      <div className="text-fg-3 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span>{formatIssueStatus(issue)}</span>
        <span className="text-border">/</span>
        {actionLink === null ? (
          <span>{actionLabel}</span>
        ) : (
          <Link
            className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
            to={actionLink}
          >
            {actionLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
