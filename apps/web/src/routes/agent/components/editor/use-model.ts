import type { JsonObject } from "@mosoo/contracts";
import { classifyAgentConfigChanges } from "@mosoo/contracts/agent-config-change-plan";
import type { AgentConfigChangePlan } from "@mosoo/contracts/agent-config-change-plan";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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
  toSpaceId,
} from "@/routes/typed-id";

import type {
  Agent,
  AgentKind,
  McpServer,
  RuntimeId,
  SkillInfo,
  SpaceBinding,
} from "../../agent.types";
import {
  createDraftYaml,
  createDraftYamlHash,
  createEditorSaveSnapshot,
  createInitialDraft,
  createSnapshotHash,
  normalizeMcpServers,
  normalizeSpaces,
  toAgentConfigChangeSnapshot,
} from "./draft";
import type { AgentEditorDraft } from "./draft";
import { applyAgentEditorBuilderPatch, applyAgentEditorPatch, withEnvironmentId } from "./patch";
import type { AgentEditorBuilderPatch, AgentEditorBuilderPatchApplyResult } from "./patch";
import { AGENT_FORM_HIGHLIGHT_DURATION_MS } from "./section-ids";
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
  draftYaml: string;
  draftYamlHash: string;
  changePlan: AgentConfigChangePlan;
  discard(): void;
  dirty: boolean;
  readOnly: boolean;
  save(): Promise<boolean>;
  saveError: string | null;
  saving: boolean;
  revision: number;
  snapshotHash: string;
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
  setSpaces(spaces: SpaceBinding[]): void;
  applyPatch(patch: Record<string, unknown>): void;
  applyBuilderPatch(patch: AgentEditorBuilderPatch): AgentEditorBuilderPatchApplyResult;
  applyAndSaveBuilderPatch(
    patch: AgentEditorBuilderPatch,
  ): Promise<AgentEditorBuilderPatchAutoApplyResult>;
  focusSection: AgentFormSectionId | null;
  highlightedSections: ReadonlySet<AgentFormSectionId>;
  focusBuilderPatchSection(sectionId: AgentFormSectionId): void;
  markCurrentDraftSaved(draftYamlHash: string): void;
}

export interface AgentEditorBuilderPatchAutoApplyResult extends AgentEditorBuilderPatchApplyResult {
  saveError: string | null;
  saved: boolean;
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
  const draftRef = useRef<AgentEditorDraft>(initialDraft);
  const [revision, setRevision] = useState(0);
  const [focusSection, setFocusSection] = useState<AgentFormSectionId | null>(null);
  const [highlightedSections, setHighlightedSections] = useState<ReadonlySet<AgentFormSectionId>>(
    new Set(),
  );
  const highlightClearTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
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

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(
    () => () => {
      if (highlightClearTimerRef.current !== null) {
        globalThis.clearTimeout(highlightClearTimerRef.current);
      }
    },
    [],
  );

  function focusAndHighlightSections(sectionIds: readonly AgentFormSectionId[]): void {
    if (sectionIds.length === 0) {
      return;
    }

    setFocusSection(sectionIds[0] ?? null);
    setHighlightedSections(new Set(sectionIds));

    if (highlightClearTimerRef.current !== null) {
      globalThis.clearTimeout(highlightClearTimerRef.current);
    }

    highlightClearTimerRef.current = globalThis.setTimeout(() => {
      setHighlightedSections(new Set());
      highlightClearTimerRef.current = null;
    }, AGENT_FORM_HIGHLIGHT_DURATION_MS);
  }

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
        builder: {
          componentDecisions: draftToSave.componentDecisions,
        },
        description: draftToSave.description.trim() || null,
        environment: {
          boundSpaceIds: normalizeSpaces(draftToSave.spaces).map((space) => toSpaceId(space.id)),
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
    applyBuilderPatch(patch) {
      const result = applyAgentEditorBuilderPatch(draft, patch);

      if (createEditorSaveSnapshot(result.draft) !== createEditorSaveSnapshot(draft)) {
        setDraft(result.draft);
        setRevision((currentRevision) => currentRevision + 1);
      }

      focusAndHighlightSections(result.appliedSections);

      return result;
    },
    async applyAndSaveBuilderPatch(patch) {
      const result = applyAgentEditorBuilderPatch(draft, patch);
      const changed = createEditorSaveSnapshot(result.draft) !== createEditorSaveSnapshot(draft);

      if (changed) {
        setDraft(result.draft);
        setRevision((currentRevision) => currentRevision + 1);
      }

      focusAndHighlightSections(result.appliedSections);

      if (!changed) {
        return {
          ...result,
          saveError: null,
          saved: false,
        };
      }

      const saveResult = await persistDraft(result.draft, { runRuntimeOperations: true });

      return {
        ...result,
        saveError: saveResult.error,
        saved: saveResult.ok,
      };
    },
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
    draftYaml: createDraftYaml(draft),
    draftYamlHash: createDraftYamlHash(draft),
    focusBuilderPatchSection(sectionId) {
      setFocusSection(sectionId);
      setHighlightedSections(new Set([sectionId]));
    },
    focusSection,
    highlightedSections,
    markCurrentDraftSaved(draftYamlHash) {
      const currentDraft = draftRef.current;

      if (createDraftYamlHash(currentDraft) !== draftYamlHash) {
        return;
      }

      setSavedDraft(currentDraft);
      setSavedSnapshot(createEditorSaveSnapshot(currentDraft));
      setSaveError(null);
    },
    readOnly,
    revision,
    save,
    saveError,
    saving,
    snapshotHash: createSnapshotHash(draft),
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
        componentDecisions: {
          ...current.componentDecisions,
          agentType: "decided",
        },
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
      }));
    },
    setModelSelection(selection) {
      updateDraft((current) => ({
        ...current,
        model: selection.model,
        provider: selection.provider,
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
        runtime,
      }));
    },
    setSkills(skills) {
      updateDraft((current) => ({
        ...current,
        skills,
      }));
    },
    setSpaces(spaces) {
      updateDraft((current) => ({
        ...current,
        spaces: normalizeSpaces(spaces),
      }));
    },
  };
}
