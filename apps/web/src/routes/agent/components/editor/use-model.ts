import type { JsonObject } from "@mosoo/contracts";
import type { AgentBuiltInToolConfig } from "@mosoo/contracts/agent";
import {
  getAgentBuiltInToolSupportError,
  normalizeAgentBuiltInTools,
} from "@mosoo/contracts/agent";
import { normalizeRuntimeAdvancedSettings } from "@mosoo/runtime-catalog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { updateAgentConfig } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import {
  toAgentId,
  toEnvironmentId,
  toMcpServerId,
  toProjectId,
  toSkillId,
} from "@/routes/typed-id";

import type { Agent, McpServer, RuntimeId, SkillInfo } from "../../agent.types";
import { createEditorSaveSnapshot, createInitialDraft, normalizeMcpServers } from "./draft";
import type { AgentEditorDraft } from "./draft";

export type { AgentEditorDraft } from "./draft";

export interface AgentEditorModel {
  draft: AgentEditorDraft;
  discard(): void;
  dirty: boolean;
  save(): Promise<boolean>;
  saveError: string | null;
  saving: boolean;
  snapshot: string;
  setBuiltInTools(tools: AgentBuiltInToolConfig[]): void;
  setDescription(description: string): void;
  setEnvironmentId(environmentId: string | null): void;
  setMcpServers(servers: McpServer[]): void;
  setModel(model: string): void;
  setModelSelection(selection: { model: string; provider: string }): void;
  setName(name: string): void;
  setPrompt(prompt: string): void;
  setProviderOptions(providerOptions: JsonObject): void;
  setRuntime(runtime: RuntimeId): void;
  setSkills(skills: SkillInfo[]): void;
}

export function useAgentEditorModel({ agent }: { agent: Agent }): AgentEditorModel {
  const queryClient = useQueryClient();
  const initialDraft = createInitialDraft(agent);
  const [draft, setDraft] = useState<AgentEditorDraft>(initialDraft);
  const [savedDraft, setSavedDraft] = useState<AgentEditorDraft>(initialDraft);
  const [savedSnapshot, setSavedSnapshot] = useState(() => createEditorSaveSnapshot(initialDraft));
  const [saveError, setSaveError] = useState<string | null>(null);
  const typedAgentId = toAgentId(agent.id);
  const typedProjectId = toProjectId(agent.projectId);
  const configMutation = useMutation({
    mutationFn: updateAgentConfig,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: agentKeys.detail(variables.projectId, variables.agentId),
        }),
        queryClient.invalidateQueries({
          queryKey: agentKeys.editorState(variables.projectId, variables.agentId),
        }),
        queryClient.invalidateQueries({ queryKey: agentKeys.lists() }),
      ]);
    },
  });
  const snapshot = createEditorSaveSnapshot(draft);
  const dirty = snapshot !== savedSnapshot;
  const saving = configMutation.isPending;

  async function persistDraft(
    draftToSave: AgentEditorDraft,
  ): Promise<{ error: string | null; ok: boolean }> {
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

    const toolSupportError = getAgentBuiltInToolSupportError(
      draftToSave.runtime,
      draftToSave.builtInTools,
    );
    if (toolSupportError) {
      setSaveError(toolSupportError);
      return { error: toolSupportError, ok: false };
    }

    setSaveError(null);

    try {
      await configMutation.mutateAsync({
        agentId: typedAgentId,
        builtInTools: normalizeAgentBuiltInTools(draftToSave.builtInTools),
        description: draftToSave.description.trim() || null,
        environment: {
          environmentId:
            draftToSave.environmentId === null ? null : toEnvironmentId(draftToSave.environmentId),
        },
        mcpServerIds: normalizeMcpServers(draftToSave.mcpServers).map((server) =>
          toMcpServerId(server.id),
        ),
        model,
        name,
        prompt: draftToSave.prompt,
        provider,
        providerOptions: draftToSave.providerOptions,
        projectId: typedProjectId,
        runtimeId: draftToSave.runtime,
        skillIds: draftToSave.skills.flatMap((skill) =>
          skill.state === "tombstone" ? [] : [toSkillId(skill.id)],
        ),
      });
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
    return (await persistDraft(draft)).ok;
  }

  return {
    dirty,
    discard() {
      setDraft(savedDraft);
      setSaveError(null);
    },
    draft,
    save,
    saveError,
    saving,
    snapshot,
    setBuiltInTools(tools) {
      setDraft((current) => ({
        ...current,
        builtInTools: normalizeAgentBuiltInTools(tools),
      }));
    },
    setDescription(description) {
      setDraft((current) => ({
        ...current,
        description,
      }));
    },
    setEnvironmentId(environmentId) {
      setDraft((current) => ({
        ...current,
        environmentId,
      }));
    },
    setMcpServers(servers) {
      setDraft((current) => ({
        ...current,
        mcpServers: normalizeMcpServers(servers),
      }));
    },
    setModel(model) {
      setDraft((current) => ({
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
      setDraft((current) => ({
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
      setDraft((current) => ({
        ...current,
        name,
      }));
    },
    setPrompt(prompt) {
      setDraft((current) => ({
        ...current,
        prompt,
      }));
    },
    setProviderOptions(providerOptions) {
      setDraft((current) => ({
        ...current,
        providerOptions,
      }));
    },
    setRuntime(runtime) {
      setDraft((current) => ({
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
      setDraft((current) => ({
        ...current,
        skills,
      }));
    },
  };
}
