import type { JsonObject } from "@mosoo/contracts";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getPrimaryProviderReadinessPresentation } from "@/domains/vendor-credential/model/provider-readiness-copy";
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
import { AgentSpacesField } from "./spaces-field";
import type { AgentEditorModel } from "./use-model";

function formatProviderOptions(value: JsonObject): string {
  return JSON.stringify(value, null, 2);
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseProviderOptionsJson(text: string): JsonObject {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {};
  }

  const parsed: unknown = JSON.parse(trimmed);
  if (!isJsonObject(parsed)) {
    throw new Error("Advanced settings must be a JSON object.");
  }

  return parsed;
}

function AdvancedProviderOptionsField({
  model,
  readOnly,
}: {
  model: AgentEditorModel;
  readOnly: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(() => formatProviderOptions(model.draft.providerOptions));
  const [error, setError] = useState<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const serializedProviderOptions = formatProviderOptions(model.draft.providerOptions);

  useEffect(() => {
    if (document.activeElement === textAreaRef.current) {
      return;
    }

    setText(serializedProviderOptions);
    setError(null);
  }, [serializedProviderOptions]);

  function commitProviderOptions(nextText: string): void {
    try {
      const providerOptions = parseProviderOptionsJson(nextText);
      model.setProviderOptions(providerOptions);
      setText(formatProviderOptions(providerOptions));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Advanced settings JSON is invalid.");
    }
  }

  return (
    <div className="border-border-subtle rounded-lg border bg-white">
      <button
        aria-expanded={expanded}
        className="focus-visible:ring-brand-ring flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => {
          setExpanded((current) => !current);
        }}
        type="button"
      >
        <span className="min-w-0">
          <span className="text-foreground block text-[13px] font-medium">
            Advanced settings (JSON, applied to runtime config)
          </span>
          <span className="text-muted-foreground block text-[11px]">
            Validated by the runtime, not by Mosoo
          </span>
        </span>
        <ChevronDown
          className={cn("text-muted-foreground size-4 shrink-0 transition-transform", {
            "rotate-180": expanded,
          })}
        />
      </button>

      {expanded ? (
        <div className="border-border-subtle border-t px-3 pt-2 pb-3">
          <textarea
            aria-invalid={error !== null}
            aria-label="Advanced settings JSON"
            className={cn(
              "border-border focus:ring-brand-ring min-h-[160px] w-full resize-y rounded-lg border bg-white px-3 py-2 font-mono text-[12px] leading-relaxed outline-none focus:ring-2",
              error !== null ? "border-red-300 focus:ring-red-200" : null,
            )}
            onBlur={() => {
              commitProviderOptions(text);
            }}
            onChange={(event) => {
              setText(event.target.value);
              if (error !== null) {
                setError(null);
              }
            }}
            readOnly={readOnly}
            ref={textAreaRef}
            spellCheck={false}
            value={text}
          />
          {error !== null ? (
            <div className="mt-2 text-[12px] leading-relaxed text-red-600" role="alert">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReadinessBanner({ agent }: { agent: Agent }) {
  if (!agent.readiness || agent.readiness.ready || agent.readiness.issues.length === 0) {
    return null;
  }

  const errors = agent.readiness.issues.filter((issue) => issue.severity === "error");

  if (errors.length === 0) {
    return null;
  }

  const primary = errors[0];
  const providerPresentation = getPrimaryProviderReadinessPresentation(errors);

  if (providerPresentation?.action === "add-provider-key") {
    return null;
  }

  const message =
    providerPresentation?.message ??
    primary?.message ??
    "Resolve configuration before preview or publish.";

  return (
    <div
      className="border-amber/30 bg-amber-bg text-amber-fg rounded-lg border px-3 py-2.5"
      role="alert"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <AlertTriangle className="size-4 shrink-0" />
            {providerPresentation?.title ?? "Configuration required"}
          </div>
          <div className="mt-1 text-[12px] leading-relaxed">{message}</div>
          {providerPresentation?.originalMessage !== undefined &&
          providerPresentation.originalMessage !== null &&
          providerPresentation.originalMessage !== message ? (
            <div className="text-amber-fg/80 mt-1 text-[11px] leading-relaxed">
              {providerPresentation.originalMessage}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

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
      <ReadinessBanner agent={agent} />
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
          <AdvancedProviderOptionsField model={model} readOnly={readOnly} />
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

      <div>
        <SectionHeader>Spaces</SectionHeader>
        <AgentSpacesField
          appId={agent.appId}
          readOnly={readOnly}
          selectedSpaces={model.draft.spaces}
          setSpaces={model.setSpaces}
        />
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
