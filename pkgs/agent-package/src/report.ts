import type {
  AgentPackageResolutionReport,
  AgentPackageResolutionSource,
  AgentPackageResolutionState,
  AgentPackageResolutionSummary,
  AgentResolutionIssue,
  AgentResolutionTargetType,
} from "@mosoo/contracts/agent-manifest";

function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

export function createResolutionIssue(input: {
  actionLabel?: string | null;
  code: string;
  message: string;
  required?: boolean;
  severity?: AgentResolutionIssue["severity"];
  status?: AgentResolutionIssue["status"];
  targetLabel?: string | null;
  targetType: AgentResolutionTargetType;
}): AgentResolutionIssue {
  return {
    actionLabel: input.actionLabel ?? null,
    code: input.code,
    message: input.message,
    required: input.required ?? true,
    severity: input.severity ?? "error",
    status: input.status ?? "missing",
    targetLabel: input.targetLabel ?? null,
    targetType: input.targetType,
  };
}

export function createPackageMcpNeedsReconnectIssue(input: {
  message?: string;
  required?: boolean;
  serverName: string;
  severity?: AgentResolutionIssue["severity"];
}): AgentResolutionIssue {
  return createResolutionIssue({
    actionLabel: "Connect MCP",
    code: "agent.package.mcp.needs_reconnect",
    message:
      input.message ?? `MCP server ${input.serverName} must be connected before runtime use.`,
    ...(input.required === undefined ? {} : { required: input.required }),
    ...(input.severity === undefined ? {} : { severity: input.severity }),
    status: "needs_reconnect",
    targetLabel: input.serverName,
    targetType: "mcp_server",
  });
}

export function createEmptyResolutionSummary(): AgentPackageResolutionSummary {
  return {
    boundMcpServerCount: 0,
    boundSkillCount: 0,
    boundSpaceCount: 0,
    copiedAssetCount: 0,
    createdMcpServerCount: 0,
    reusedMcpServerCount: 0,
  };
}

export function createResolutionReport(
  issues: AgentResolutionIssue[],
  summary: AgentPackageResolutionSummary,
): AgentPackageResolutionReport {
  return {
    issues,
    summary: {
      boundMcpServerCount: summary.boundMcpServerCount,
      boundSkillCount: summary.boundSkillCount,
      boundSpaceCount: summary.boundSpaceCount,
      copiedAssetCount: summary.copiedAssetCount,
      createdMcpServerCount: summary.createdMcpServerCount,
      reusedMcpServerCount: summary.reusedMcpServerCount,
    },
  };
}

export function hasBlockingResolutionIssues(report: AgentPackageResolutionReport): boolean {
  return report.issues.some(
    (issue) =>
      issue.required &&
      issue.severity === "error" &&
      issue.status !== "resolved" &&
      issue.status !== "warning",
  );
}

export function createPackageResolutionState(
  source: AgentPackageResolutionSource,
  report: AgentPackageResolutionReport,
): AgentPackageResolutionState | null {
  if (!hasBlockingResolutionIssues(report)) {
    return report.issues.length > 0
      ? {
          recordedAt: toIsoString(Date.now()),
          report,
          source,
        }
      : null;
  }

  return {
    recordedAt: toIsoString(Date.now()),
    report,
    source,
  };
}
