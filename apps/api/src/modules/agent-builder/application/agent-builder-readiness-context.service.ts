import type { AgentEnvironmentConfig } from "@mosoo/contracts/agent";
import type {
  AgentBuilderReadinessContext,
  AgentBuilderReadinessIssueSummary,
} from "@mosoo/contracts/agent-builder";
import type { AccountId, AgentId, OrganizationId, AppId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { currentTimestampMs, toIsoString } from "../../../time";
import { computeAgentReadiness } from "../../agents/application/agent-readiness.service";
import type { AgentBuilderPlannerDraftInput } from "./agent-builder-planner-draft-input";
import { resolveAgentBuilderPlannerDraftInput } from "./agent-builder-planner-draft-input";

function createReadinessIssue(
  code: string,
  message: string,
  severity: AgentBuilderReadinessIssueSummary["severity"] = "error",
): AgentBuilderReadinessIssueSummary {
  return {
    code,
    message,
    severity,
  };
}

function toReadinessContext(input: {
  checkedAt: string;
  issues: AgentBuilderReadinessIssueSummary[];
}): AgentBuilderReadinessContext {
  const errorCount = input.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = input.issues.filter((issue) => issue.severity === "warning").length;

  return {
    checkedAt: input.checkedAt,
    errorCount,
    issues: input.issues,
    ready: errorCount === 0,
    warningCount,
  };
}

function createLocalReadinessContext(
  issues: AgentBuilderReadinessIssueSummary[],
): AgentBuilderReadinessContext {
  return toReadinessContext({
    checkedAt: toIsoString(currentTimestampMs()),
    issues,
  });
}

function collectRequiredDraftSelectionIssues(input: {
  model: string | null;
  provider: string | null;
  runtimeId: string | null;
}): AgentBuilderReadinessIssueSummary[] {
  const issues: AgentBuilderReadinessIssueSummary[] = [];

  if (input.runtimeId === null || input.runtimeId.trim() === "") {
    issues.push(
      createReadinessIssue(
        "agent_builder.runtime.missing",
        "Draft runtime is required before the Agent can be tested, previewed, or deployed.",
      ),
    );
  }

  if (input.provider === null || input.provider.trim() === "") {
    issues.push(
      createReadinessIssue(
        "agent_builder.provider.missing",
        "Draft provider is required before the Agent can be tested, previewed, or deployed.",
      ),
    );
  }

  if (input.model === null || input.model.trim() === "") {
    issues.push(
      createReadinessIssue(
        "agent_builder.model.missing",
        "Draft model is required before the Agent can be tested, previewed, or deployed.",
      ),
    );
  }

  return issues;
}

export async function collectAgentBuilderReadinessContext(
  bindings: ApiBindings,
  input: {
    agent: {
      id: AgentId;
      ownerId: AccountId;
      appOrganizationId: OrganizationId;
      appId: AppId;
    };
  } & AgentBuilderPlannerDraftInput,
): Promise<AgentBuilderReadinessContext> {
  const draft = resolveAgentBuilderPlannerDraftInput(input);

  if (draft.parseStatus === "failed") {
    return createLocalReadinessContext([
      createReadinessIssue(
        "agent_builder.draft_yaml.invalid",
        draft.parseError ?? "Draft YAML could not be parsed.",
      ),
    ]);
  }

  const model = draft.model?.trim() ?? "";
  const provider = draft.provider?.trim() ?? "";
  const runtimeId = draft.runtimeId?.trim() ?? "";
  const selectionIssues = collectRequiredDraftSelectionIssues({
    model,
    provider,
    runtimeId,
  });

  if (selectionIssues.length > 0) {
    return createLocalReadinessContext(selectionIssues);
  }

  const environment: AgentEnvironmentConfig = {
    boundSpaceIds: draft.spaceIds,
    environmentId: draft.environmentId,
  };
  const readiness = await computeAgentReadiness(bindings.DB, input.agent.ownerId, {
    agentId: input.agent.id,
    bindings,
    environment,
    ...(draft.mcpServersRepresented ? { mcpServerIds: draft.mcpServerIds } : {}),
    model,
    appId: input.agent.appId,
    provider,
    runtimeId,
  });

  return toReadinessContext(readiness);
}
