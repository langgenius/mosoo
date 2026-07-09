import type { JsonObject } from "@mosoo/contracts";
import type { AgentBuiltInToolConfig } from "@mosoo/contracts/agent";
import { normalizeAgentBuiltInTools } from "@mosoo/contracts/agent";
import { classifyAgentConfigChanges } from "@mosoo/contracts/agent-config-change-plan";
import type { AgentConfigChangePlan } from "@mosoo/contracts/agent-config-change-plan";
import { normalizeRuntimeAdvancedSettings } from "@mosoo/runtime-catalog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  recreateSandbox,
  restartDriver,
  updateAgentConfig,
} from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import {
  toAgentId,
  toAgentDeploymentVersionId,
  toEnvironmentId,
  toMcpServerId,
  toAppId,
  toSkillId,
} from "@/routes/typed-id";

import type { Agent, AgentKind, McpServer, RuntimeId, SkillInfo } from "../../agent.types";
import {
  createEditorSaveSnapshot,
  createInitialDraft,
  createSnapshotHash,
  normalizeMcpServers,
  toAgentConfigChangeSnapshot,
} from "./draft";
import type { AgentEditorDraft } from "./draft";
import { applyAgentEditorPatch, withEnvironmentId } from "./patch";
import type { AgentFormSectionId } from "./section-ids";

export type { AgentEditorDraft } from "./draft";

function toRuntimeOperationTargetVersion(agent: {
  liveVersion: { id: string; versionNumber: number } | null;
  status: string;
}) {
  if (agent.status !== "published" || agent.liveVersion === null) {
    return null;
  }

  return {
    id: toAgentDeploymentVersionId(agent.liveVersion.id),
    versionNumber: agent.liveVersion.versionNumber,
  };
}

export interface AgentEditorModel {
  draft: AgentEditorDraft;
  changePlan: AgentConfigChangePlan;
  discard(): void;
  dirty: boolean;
  readOnly: boolean;
  save(): Promise<boolean>;
  saveError: string | null;
  saving: boolean;
  revision: number;
  snapshotHash: string;
  setBuiltInTools(tools: AgentBuiltInToolConfig[]): void;
  setDescription(description: string): void;
  setEnvironmentId(environmentId: string | null): void;
  setKind(kind: AgentKind): void;
  setMcpServers(servers: McpServer[]): void;
  setModel(model: string): void;
  setModelSelection(selection: { model: string; provider: string }): void;
  setName(name: string): void;
  setPrompt(prompt: string): void;
  setProviderOptions(providerOptions: JsonObject): void;
  setRuntime(runtime: RuntimeId): void;
  setSkills(skills: SkillInfo[]): void;
  applyPatch(patch: Record<string, unknown>): void;
  focusSection: AgentFormSectionId | null;
  highlightedSections: ReadonlySet<AgentFormSectionId>;
}

export function useAgentEditorModel({
  agent,
  readOnly = false,
}: {
  agent: Agent;
  readOnly?: boolean;
}): AgentEditorModel {
  const queryClient = useQueryClient();
  const initialDraft = createInitialDraft(agent);
  const [draft, setDraft] = useState<AgentEditorDraft>(initialDraft);
  const [revision, setRevision] = useState(0);
  const [focusSection, setFocusSection] = useState<AgentFormSectionId | null>(null);
  const [highlightedSections, setHighlightedSections] = useState<ReadonlySet<AgentFormSectionId>>(
    new Set(),
  );
  const [savedDraft, setSavedDraft] = useState<AgentEditorDraft>(initialDraft);
  const [savedSnapshot, setSavedSnapshot] = useState(() => createEditorSaveSnapshot(initialDraft));
  const [saveError, setSaveError] = useState<string | null>(null);
  const typedAgentId = toAgentId(agent.id);
  const typedAppId = toAppId(agent.appId);
  const configMutation = useMutation({
    mutationFn: updateAgentConfig,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentKeys.detail(variables.appId, variables.agentId),
        }),
        queryClient.invalidateQueries({
          queryKey: agentKeys.editorState(variables.appId, variables.agentId),
        }),
        queryClient.invalidateQueries({ queryKey: agentKeys.lists() }),
      ]);
    },
  });
  const restartDriverMutation = useMutation({
    mutationFn: restartDriver,
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: agentKeys.detail(variables.appId, variables.agentId),
      });
    },
  });
  const recreateSandboxMutation = useMutation({
    mutationFn: recreateSandbox,
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: agentKeys.detail(variables.appId, variables.agentId),
      });
    },
  });

  const dirty = createEditorSaveSnapshot(draft) !== savedSnapshot;
  const changePlan = classifyAgentConfigChanges({
    agentStatus: agent.status,
    current: toAgentConfigChangeSnapshot(draft),
    saved: toAgentConfigChangeSnapshot(savedDraft),
  });
  const saving =
    configMutation.isPending ||
    restartDriverMutation.isPending ||
    recreateSandboxMutation.isPending;

  function updateDraft(transform: (current: AgentEditorDraft) => AgentEditorDraft) {
    setDraft((current) => transform(current));
    setRevision((currentRevision) => currentRevision + 1);
  }

  async function persistDraft(
    draftToSave: AgentEditorDraft,
    options: { runRuntimeOperations: boolean },
  ): Promise<{ error: string | null; ok: boolean }> {
    if (readOnly) {
      return { error: null, ok: false };
    }

    const name = draftToSave.name.trim();
    const model = draftToSave.model.trim();
    const provider = draftToSave.provider.trim();

    if (!name) {
      const error = "Agent name is required.";
      setSaveError(error);
      return { error, ok: false };
    }

    if (!model) {
      const error = "Model is required.";
      setSaveError(error);
      return { error, ok: false };
    }

    if (!provider) {
      const error = "Provider is required.";
      setSaveError(error);
      return { error, ok: false };
    }

    const draftChangePlan = classifyAgentConfigChanges({
      agentStatus: agent.status,
      current: toAgentConfigChangeSnapshot(draftToSave),
      saved: toAgentConfigChangeSnapshot(savedDraft),
    });

    if (draftChangePlan.action === "fork-agent") {
      const error = "Fork the Agent to change type or runtime after publishing.";
      setSaveError(error);
      return { error, ok: false };
    }

    setSaveError(null);

    try {
      const savedAgent = await configMutation.mutateAsync({
        agentId: typedAgentId,
        builtInTools: normalizeAgentBuiltInTools(draftToSave.builtInTools),
        description: draftToSave.description.trim() || null,
        environment: {
          environmentId:
            draftToSave.environmentId === null ? null : toEnvironmentId(draftToSave.environmentId),
        },
        kind: draftToSave.kind,
        mcpServerIds: normalizeMcpServers(draftToSave.mcpServers).map((server) =>
          toMcpServerId(server.id),
        ),
        model,
        name,
        prompt: draftToSave.prompt,
        provider,
        providerOptions: draftToSave.providerOptions,
        appId: typedAppId,
        runtimeId: draftToSave.runtime,
        skillIds: draftToSave.skills.flatMap((skill) =>
          skill.state === "tombstone" ? [] : [toSkillId(skill.id)],
        ),
      });
      const targetVersion = toRuntimeOperationTargetVersion(savedAgent);

      if (options.runRuntimeOperations && draftChangePlan.requiresRuntimeOperation) {
        if (draftChangePlan.action === "recreate-preserving-state") {
          await recreateSandboxMutation.mutateAsync({
            affectedFields: draftChangePlan.fieldLabels,
            agentId: typedAgentId,
            applyActionKind: "recreate-preserving-state",
            appId: typedAppId,
            targetVersion,
          });
        } else if (
          draftChangePlan.action === "patch-and-restart" ||
          draftChangePlan.action === "restart-process"
        ) {
          await restartDriverMutation.mutateAsync({
            affectedFields: draftChangePlan.fieldLabels,
            agentId: typedAgentId,
            applyActionKind: draftChangePlan.action,
            appId: typedAppId,
            targetVersion,
          });
        }
      }

      setSavedDraft(draftToSave);
      setSavedSnapshot(createEditorSaveSnapshot(draftToSave));
      return { error: null, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save agent changes.";
      setSaveError(message);
      return { error: message, ok: false };
    }
  }

  async function save() {
    return (await persistDraft(draft, { runRuntimeOperations: true })).ok;
  }

  return {
    applyPatch(patch) {
      updateDraft((current) => applyAgentEditorPatch(current, patch));
    },
    changePlan,
    dirty,
    discard() {
      setDraft(savedDraft);
      setRevision((currentRevision) => currentRevision + 1);
      setHighlightedSections(new Set());
      setFocusSection(null);
      setSaveError(null);
    },
    draft,
    focusSection,
    highlightedSections,
    readOnly,
    revision,
    save,
    saveError,
    saving,
    snapshotHash: createSnapshotHash(draft),
    setBuiltInTools(tools) {
      updateDraft((current) => ({
        ...current,
        builtInTools: normalizeAgentBuiltInTools(tools),
      }));
    },
    setDescription(description) {
      updateDraft((current) => ({
        ...current,
        description,
      }));
    },
    setEnvironmentId(environmentId) {
      updateDraft((current) => withEnvironmentId(current, environmentId));
    },
    setKind(kind) {
      updateDraft((current) => ({
        ...current,
        kind,
      }));
    },
    setMcpServers(servers) {
      updateDraft((current) => ({
        ...current,
        mcpServers: normalizeMcpServers(servers),
      }));
    },
    setModel(model) {
      updateDraft((current) => ({
        ...current,
        model,
        providerOptions: normalizeRuntimeAdvancedSettings({
          modelId: model,
          runtimeId: current.runtime,
          settings: current.providerOptions,
        }),
      }));
    },
    setModelSelection(selection) {
      updateDraft((current) => ({
        ...current,
        model: selection.model,
        provider: selection.provider,
        providerOptions: normalizeRuntimeAdvancedSettings({
          modelId: selection.model,
          runtimeId: current.runtime,
          settings: current.providerOptions,
        }),
      }));
    },
    setName(name) {
      updateDraft((current) => ({
        ...current,
        name,
      }));
    },
    setPrompt(prompt) {
      updateDraft((current) => ({
        ...current,
        prompt,
      }));
    },
    setProviderOptions(providerOptions) {
      updateDraft((current) => ({
        ...current,
        providerOptions,
      }));
    },
    setRuntime(runtime) {
      updateDraft((current) => ({
        ...current,
        providerOptions: normalizeRuntimeAdvancedSettings({
          modelId: current.model,
          runtimeId: runtime,
          settings: current.providerOptions,
        }),
        runtime,
      }));
    },
    setSkills(skills) {
      updateDraft((current) => ({
        ...current,
        skills,
      }));
    },
  };
}
