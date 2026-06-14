import type {
  Agent,
  AgentDeploymentVersion,
  AgentDetail,
  AgentOwnerSummary,
  AgentSkillReference,
  AgentSummary,
  AgentToolSummary,
  AgentViewerRole,
} from "@mosoo/contracts/agent";

import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  getAgentLiveDeploymentVersionRecord,
  listAgentDeploymentVersionRecords,
  toAgentDeploymentVersionModel,
} from "./agent-deployment-version.service";
import {
  listAgentOwnerSummaries,
  listAgentToolSummaries,
  listAgentToolSummariesByAgentIds,
} from "./agent-repository";
import { toAgentRuntimeModelProjection } from "./agent-runtime-model-identity";
import { listResolvedAgentSkills } from "./agent-skill-resolution.service";
import type { AgentRow } from "./agent-types";

function visibleAgentPrompt(prompt: string, viewerRole: AgentViewerRole): string {
  return viewerRole === "owner" ? prompt : "";
}

function canReadAgentEditorState(viewerRole: AgentViewerRole): boolean {
  return viewerRole === "owner";
}

interface AgentDetailEditorData {
  liveVersion: AgentDeploymentVersion | null;
  skills: AgentSkillReference[];
  tools: AgentToolSummary[];
  versions: AgentDeploymentVersion[];
}

function visibleAgentCatalogValue(value: string, viewerRole: AgentViewerRole): string {
  return canReadAgentEditorState(viewerRole) ? value : "";
}

function visibleAgentToolSummaries(
  tools: AgentToolSummary[],
  viewerRole: AgentViewerRole,
): AgentToolSummary[] {
  if (canReadAgentEditorState(viewerRole)) {
    return tools;
  }

  return [];
}

function toAgentModelFromLoadedData(
  agent: AgentRow,
  input: {
    liveVersion: AgentDeploymentVersion | null;
    skills: AgentSkillReference[];
  },
): Agent {
  const runtimeModel = toAgentRuntimeModelProjection(agent);

  return {
    createdAt: toIsoString(agent.createdAt),
    description: agent.description,
    id: agent.id,
    kind: agent.kind,
    liveVersion: input.liveVersion,
    model: runtimeModel.model,
    name: agent.name,
    organizationId: agent.organizationId,
    appId: agent.appId,
    prompt: agent.prompt,
    provider: runtimeModel.provider,
    runtimeId: runtimeModel.runtimeId,
    skills: input.skills,
    status: agent.status,
    updatedAt: toIsoString(agent.updatedAt),
    visibility: agent.visibility,
  };
}

export async function toAgentModel(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agent: AgentRow,
): Promise<Agent> {
  const liveVersion = await getAgentLiveDeploymentVersionRecord(database, agent);

  return toAgentModelFromLoadedData(agent, {
    liveVersion: liveVersion
      ? toAgentDeploymentVersionModel(liveVersion, agent.liveDeploymentVersionId)
      : null,
    skills: await listResolvedAgentSkills(database, viewer, agent.id),
  });
}

function toAgentSummaryModelFromLoadedData(
  agent: AgentRow,
  input: {
    owner: AgentOwnerSummary;
    tools: AgentToolSummary[];
    viewerRole: AgentViewerRole;
  },
): AgentSummary {
  const runtimeModel = toAgentRuntimeModelProjection(agent);

  return {
    createdAt: toIsoString(agent.createdAt),
    description: agent.description,
    id: agent.id,
    kind: agent.kind,
    name: agent.name,
    organizationId: agent.organizationId,
    appId: agent.appId,
    owner: input.owner,
    runtimeId: visibleAgentCatalogValue(runtimeModel.runtimeId, input.viewerRole),
    status: agent.status,
    tools: visibleAgentToolSummaries(input.tools, input.viewerRole),
    updatedAt: toIsoString(agent.updatedAt),
    viewerRole: input.viewerRole,
    visibility: agent.visibility,
  };
}

export async function toAgentSummaryModels(
  database: D1Database,
  inputs: {
    agent: AgentRow;
    viewerRole: AgentViewerRole;
  }[],
): Promise<AgentSummary[]> {
  const [ownersById, toolsByAgentId] = await Promise.all([
    listAgentOwnerSummaries(
      database,
      inputs.map((input) => input.agent.ownerId),
    ),
    listAgentToolSummariesByAgentIds(
      database,
      inputs.map((input) => input.agent.id),
    ),
  ]);

  return inputs.map((input) =>
    toAgentSummaryModelFromLoadedData(input.agent, {
      owner: ownersById.get(input.agent.ownerId) ?? {
        id: input.agent.ownerId,
        imageUrl: null,
        name: null,
      },
      tools: toolsByAgentId.get(input.agent.id) ?? [],
      viewerRole: input.viewerRole,
    }),
  );
}

export async function toAgentDetailModel(
  database: D1Database,
  viewer: AuthenticatedViewer,
  agent: AgentRow,
  owner: AgentOwnerSummary,
  viewerRole: AgentViewerRole,
): Promise<AgentDetail> {
  const canReadEditorState = canReadAgentEditorState(viewerRole);
  const runtimeModel = toAgentRuntimeModelProjection(agent);
  const editorDataPromise: Promise<AgentDetailEditorData> = canReadEditorState
    ? Promise.all([
        listAgentDeploymentVersionRecords(database, agent.id),
        listResolvedAgentSkills(database, viewer, agent.id),
        listAgentToolSummaries(database, agent.id),
      ]).then(([versions, skills, tools]) => {
        const liveVersion =
          agent.liveDeploymentVersionId === null
            ? null
            : (versions.find((version) => version.id === agent.liveDeploymentVersionId) ?? null);

        return {
          liveVersion: liveVersion
            ? toAgentDeploymentVersionModel(liveVersion, agent.liveDeploymentVersionId)
            : null,
          skills,
          tools,
          versions: versions.map((version) =>
            toAgentDeploymentVersionModel(version, agent.liveDeploymentVersionId),
          ),
        };
      })
    : Promise.resolve({
        liveVersion: null,
        skills: [],
        tools: [],
        versions: [],
      });
  const editorData = await editorDataPromise;

  return {
    createdAt: toIsoString(agent.createdAt),
    description: agent.description,
    id: agent.id,
    kind: agent.kind,
    liveVersion: editorData.liveVersion,
    model: visibleAgentCatalogValue(runtimeModel.model, viewerRole),
    name: agent.name,
    organizationId: agent.organizationId,
    appId: agent.appId,
    owner,
    prompt: visibleAgentPrompt(agent.prompt, viewerRole),
    provider: visibleAgentCatalogValue(runtimeModel.provider, viewerRole),
    runtimeId: visibleAgentCatalogValue(runtimeModel.runtimeId, viewerRole),
    skills: editorData.skills,
    status: agent.status,
    tools: editorData.tools,
    updatedAt: toIsoString(agent.updatedAt),
    versions: editorData.versions,
    viewerRole,
    visibility: agent.visibility,
  };
}
