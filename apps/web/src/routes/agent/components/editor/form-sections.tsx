import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { AlertTriangle } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import type { Agent } from "../../agent.types";
import { isRuntimeSelectable, listRuntimeOptions } from "../../runtime-catalog";
import { PackageResolutionIssueCard } from "../package-resolution-issue-card";
import { RuntimeIcon } from "../runtime-icon";
import { EnvironmentPicker } from "./environment-picker";
import { AgentMcpBindingsField } from "./mcp-bindings-field";
import { ModelPickerField } from "./model-picker-field";
import { RequiredMark } from "./required-mark";
import { RuntimeAdvancedSettingsField } from "./runtime-advanced-settings-field";
import { SectionHeader } from "./section-header";
import { AgentSkillsField } from "./skills-field";
import type { AgentEditorModel } from "./use-model";

function PackageResolutionBanner({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const resolution = agent.packageResolution;

  if (!resolution || resolution.report.issues.length === 0) {
    return null;
  }

  const blockingIssues = resolution.report.issues.filter(
    (issue) =>
      issue.required &&
      issue.severity === "error" &&
      issue.status !== "resolved" &&
      issue.status !== "warning",
  );

  return (
    <div
      className="border-warning/30 bg-warning-bg text-warning-fg rounded-lg border px-3 py-2.5"
      role="alert"
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <AlertTriangle className="size-4 shrink-0" />
        {blockingIssues.length > 0
          ? t("agentEditor.packageRepairRequired")
          : t("agentEditor.packageRepairRecommended")}
      </div>
      <div className="mt-1 text-[12px] leading-relaxed">
        {t("agentEditor.packageRepairDescription", { source: resolution.source })}
      </div>
      <div className="mt-3 space-y-2">
        {resolution.report.issues.map((issue) => (
          <PackageResolutionIssueCard
            issue={issue}
            key={`${issue.code}:${issue.targetLabel ?? ""}`}
            requiredTone="amber"
          />
        ))}
      </div>
    </div>
  );
}

export function BasicsSection({ agent, model }: { agent: Agent; model: AgentEditorModel }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      {agent.packageResolution ? <PackageResolutionBanner agent={agent} /> : null}

      <div>
        <SectionHeader>{t("agent.identity")}</SectionHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-fg-3 text-[12px]" htmlFor="agent-name">
              {t("agentEditor.name")}
              <RequiredMark />
            </Label>
            <Input
              aria-required
              id="agent-name"
              onChange={(event) => {
                model.setName(event.target.value);
              }}
              value={model.draft.name}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-fg-3 text-[12px]" htmlFor="agent-description">
              {t("agent.descriptionLabel")}
            </Label>
            <textarea
              aria-label={t("agent.descriptionLabel")}
              className="border-border focus:ring-ring bg-card w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
              id="agent-description"
              onChange={(event) => {
                model.setDescription(event.target.value);
              }}
              placeholder={t("agent.descriptionPlaceholder")}
              rows={3}
              value={model.draft.description}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-fg-3 text-[12px]">
                {t("agent.runtime")}
                <RequiredMark />
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {listRuntimeOptions(model.draft.runtime).map((runtime) => {
                const selected = runtime.id === model.draft.runtime;
                const selectable = isRuntimeSelectable(runtime.id);

                return (
                  <button
                    aria-pressed={selected}
                    className={cn(
                      "focus-visible:ring-ring flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
                      selected && selectable
                        ? "border-emphasis bg-selected"
                        : "border-border hover:border-border-strong",
                      selectable ? null : "pointer-events-none bg-sunken/40",
                    )}
                    disabled={!selectable}
                    key={runtime.id}
                    onClick={() => {
                      model.setRuntime(runtime.id);
                    }}
                    type="button"
                  >
                    <RuntimeIcon runtime={runtime} size={24} />
                    <div className="min-w-0">
                      <div
                        className={cn(
                          "text-[13px] font-medium",
                          selectable ? "text-foreground" : "text-fg-muted",
                        )}
                      >
                        {runtime.name}
                      </div>
                      <div className="text-fg-3 text-[11px]">
                        {selectable
                          ? runtime.vendor
                          : selected
                            ? t("agentEditor.runtimeDisabled")
                            : t("agentEditor.runtimeUnavailable")}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <ModelPickerField model={model} projectId={agent.projectId} />
          <RuntimeAdvancedSettingsField
            builtInTools={model.draft.builtInTools}
            modelId={model.draft.model}
            runtimeId={model.draft.runtime}
            settings={model.draft.providerOptions}
            setBuiltInTools={model.setBuiltInTools}
            setSettings={model.setProviderOptions}
          />
        </div>
      </div>

      <div>
        <SectionHeader>{t("agent.systemPrompt")}</SectionHeader>
        <textarea
          aria-label={t("agent.systemPrompt")}
          className="border-border focus:ring-ring bg-card w-full resize-y rounded-lg border px-4 py-3 text-[13px] leading-relaxed outline-none focus:ring-2"
          onChange={(event) => {
            model.setPrompt(event.target.value);
          }}
          placeholder={t("agentEditor.systemPromptPlaceholder")}
          rows={8}
          value={model.draft.prompt}
        />
      </div>
    </div>
  );
}

export function IntegrationsSection({
  model,
  projectId,
}: {
  model: AgentEditorModel;
  projectId: string | null;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader>{t("agent.skills")}</SectionHeader>
        <AgentSkillsField
          projectId={projectId}
          selectedSkills={model.draft.skills}
          setSkills={model.setSkills}
        />
      </div>

      <div className="scroll-mt-24" id="agent-mcp-bindings">
        <SectionHeader>{t("agent.mcpServers")}</SectionHeader>
        <AgentMcpBindingsField
          projectId={projectId}
          selectedServers={model.draft.mcpServers}
          setServers={model.setMcpServers}
        />
      </div>
    </div>
  );
}

export function EnvironmentSection({ agent, model }: { agent: Agent; model: AgentEditorModel }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader>{t("agent.environment")}</SectionHeader>
        <EnvironmentPicker model={model} projectId={agent.projectId} />
      </div>
    </div>
  );
}
