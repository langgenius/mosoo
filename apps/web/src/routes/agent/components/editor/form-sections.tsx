import { AlertTriangle } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import type { Agent } from "../../agent.types";
import { isRuntimeSelectable, listRuntimeOptions } from "../../runtime-catalog";
import { AgentChannelsField } from "../channels-field";
import { PackageResolutionIssueCard } from "../package-resolution-issue-card";
import { RuntimeIcon } from "../runtime-icon";
import { EnvironmentPicker } from "./environment-picker";
import { AgentMcpBindingsField } from "./mcp-bindings-field";
import { ModelPickerField } from "./model-picker-field";
import { RequiredMark } from "./required-mark";
import { SectionHeader } from "./section-header";
import { AgentSkillsField } from "./skills-field";
import type { AgentEditorModel } from "./use-model";

function PackageResolutionBanner({ agent }: { agent: Agent }) {
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
      className="border-amber/30 bg-amber-bg text-amber-fg rounded-lg border px-3 py-2.5"
      role="alert"
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <AlertTriangle className="size-4 shrink-0" />
        Package repair {blockingIssues.length > 0 ? "required" : "recommended"}
      </div>
      <div className="mt-1 text-[12px] leading-relaxed">
        This draft was created by {resolution.source}. Required unresolved items block preview and
        publish until repaired.
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

export function BasicsSection({
  agent,
  model,
  readOnly,
}: {
  agent: Agent;
  model: AgentEditorModel;
  readOnly: boolean;
}) {
  return (
    <div className="space-y-5">
      {agent.packageResolution ? <PackageResolutionBanner agent={agent} /> : null}

      <div>
        <SectionHeader>Identity</SectionHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-[12px]" htmlFor="agent-name">
              Name
              <RequiredMark />
            </Label>
            <Input
              aria-required
              id="agent-name"
              onChange={(event) => {
                model.setName(event.target.value);
              }}
              readOnly={readOnly}
              value={model.draft.name}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground text-[12px]" htmlFor="agent-description">
              Description
            </Label>
            <textarea
              aria-label="Description"
              className="border-border focus:ring-brand-ring w-full rounded-lg border bg-white px-3 py-2 text-[13px] outline-none focus:ring-2"
              id="agent-description"
              onChange={(event) => {
                model.setDescription(event.target.value);
              }}
              placeholder="Describe what this agent does."
              readOnly={readOnly}
              rows={3}
              value={model.draft.description}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground text-[12px]">
                Runtime
                <RequiredMark />
              </Label>
              {agent.status === "published" ? (
                <span
                  className="text-muted-foreground text-[11px]"
                  title="Runtime cannot be changed in-place after publishing. Fork the Agent to switch."
                >
                  Locked · Fork Agent to switch
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {listRuntimeOptions(model.draft.runtime).map((runtime) => {
                const selected = runtime.id === model.draft.runtime;
                const selectable = isRuntimeSelectable(runtime.id);
                const publishedRuntimeLocked = agent.status === "published" && !selected;
                const disabled = readOnly || !selectable || publishedRuntimeLocked;

                return (
                  <button
                    aria-pressed={selected}
                    className={cn(
                      "focus-visible:ring-brand-ring flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
                      selected && selectable
                        ? "border-brand bg-brand-light"
                        : "border-border hover:border-brand/30",
                      disabled ? "pointer-events-none bg-muted/40 opacity-70" : null,
                    )}
                    disabled={disabled}
                    key={runtime.id}
                    onClick={() => {
                      model.setRuntime(runtime.id);
                    }}
                    type="button"
                  >
                    <RuntimeIcon runtime={runtime} size={24} />
                    <div className="min-w-0">
                      <div className="text-foreground text-[13px] font-medium">{runtime.name}</div>
                      <div className="text-muted-foreground text-[11px]">
                        {publishedRuntimeLocked
                          ? "Fork Agent required"
                          : selectable
                            ? runtime.vendor
                            : selected
                              ? "Runtime disabled"
                              : "Runtime unavailable"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {agent.status === "published" ? (
              <div className="border-amber/30 bg-amber-bg text-amber-fg rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed">
                Runtime is locked after publishing. Fork the Agent to switch runtime; existing
                sessions, cost, logs, and agent-state stay attached here.
              </div>
            ) : null}
          </div>

          <ModelPickerField model={model} appId={agent.appId} readOnly={readOnly} />
        </div>
      </div>

      <div>
        <SectionHeader>System prompt</SectionHeader>
        <textarea
          aria-label="System prompt"
          className="border-border focus:ring-brand-ring w-full resize-y rounded-lg border bg-white px-4 py-3 text-[13px] leading-relaxed outline-none focus:ring-2"
          onChange={(event) => {
            model.setPrompt(event.target.value);
          }}
          placeholder={`Describe this agent's role, boundaries, answer style, and when it should ask clarifying questions.

Example:
You are a concise operations agent. Confirm scope before changing production data. Ask clarifying questions when user intent, source data, or approval boundaries are unclear.`}
          readOnly={readOnly}
          rows={8}
          value={model.draft.prompt}
        />
      </div>
    </div>
  );
}

export function IntegrationsSection({
  model,
  appId,
  readOnly,
}: {
  model: AgentEditorModel;
  appId: string | null;
  readOnly: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <SectionHeader>Skills</SectionHeader>
        <AgentSkillsField
          appId={appId}
          readOnly={readOnly}
          selectedSkills={model.draft.skills}
          setSkills={model.setSkills}
        />
      </div>

      <div className="scroll-mt-24" id="agent-mcp-bindings">
        <SectionHeader>MCP servers</SectionHeader>
        <AgentMcpBindingsField
          appId={appId}
          readOnly={readOnly}
          selectedServers={model.draft.mcpServers}
          setServers={model.setMcpServers}
        />
      </div>
    </div>
  );
}

export function EnvironmentSection({
  agent,
  model,
  readOnly,
  showChannels,
}: {
  agent: Agent;
  model: AgentEditorModel;
  readOnly: boolean;
  showChannels: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <SectionHeader>Environment</SectionHeader>
        <EnvironmentPicker model={model} appId={agent.appId} readOnly={readOnly} />
      </div>

      {showChannels ? (
        <div>
          <SectionHeader>Channels</SectionHeader>
          <AgentChannelsField agent={agent} />
        </div>
      ) : null}
    </div>
  );
}
