import type { AgentResolutionIssue } from "@mosoo/contracts/agent-manifest";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";

function formatIssueTarget(issue: AgentResolutionIssue): string {
  const target = issue.targetLabel === null ? "" : ` · ${issue.targetLabel}`;
  return `${issue.targetType.replaceAll("_", " ")}${target}`;
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
  if (issue.targetType === "space") {
    return "Rebind space";
  }
  if (issue.targetType === "channel") {
    return "Reconnect channel";
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
  const actionLabel = getIssueActionLabel(issue);
  const actionLink = getIssueActionLink(issue);

  return (
    <div className="rounded-md bg-white/70 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-muted-foreground text-[11px] font-medium tracking-normal uppercase">
            {formatIssueTarget(issue)}
          </div>
          <div className="text-foreground mt-0.5 text-[12px] font-medium">{issue.message}</div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-normal",
            issue.required && requiredTone === "amber"
              ? "bg-amber-bg text-amber-fg"
              : "bg-muted text-muted-foreground",
          )}
        >
          {issue.required ? "required" : "optional"}
        </span>
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
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
