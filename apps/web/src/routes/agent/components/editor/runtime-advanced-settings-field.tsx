import type { JsonObject } from "@mosoo/contracts";
import { getAgentBuiltInToolSupportError } from "@mosoo/contracts/agent";
import type { AgentBuiltInToolConfig } from "@mosoo/contracts/agent";
import { normalizeAgentBuiltInTools } from "@mosoo/contracts/agent";
import type { RuntimeAdvancedSettingDefinition } from "@mosoo/runtime-catalog";
import { listRuntimeAdvancedSettings } from "@mosoo/runtime-catalog";
import { useState } from "react";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { ChevronDown } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { BuiltInToolsField } from "./built-in-tools-field";

const CLAUDE_AGENT_SDK_RUNTIME_ID = "claude-agent-sdk";

function readSettingValue(
  settings: JsonObject,
  definition: RuntimeAdvancedSettingDefinition,
): number | string | undefined {
  const value = settings[definition.key];

  if (definition.type === "select") {
    if (typeof value === "string" && definition.options.some((option) => option.value === value)) {
      return value;
    }

    return definition.defaultValue;
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (definition.valueType !== "integer" || Number.isInteger(value)) &&
    value >= definition.min
  ) {
    return value;
  }

  return definition.defaultValue;
}

function toCustomSettings(
  definitions: readonly RuntimeAdvancedSettingDefinition[],
  settings: JsonObject,
): JsonObject {
  const next: JsonObject = {};

  for (const definition of definitions) {
    const value = readSettingValue(settings, definition);

    if (value !== undefined && value !== definition.defaultValue) {
      next[definition.key] = value;
    }
  }

  return next;
}

function countCustomSettings(
  definitions: readonly RuntimeAdvancedSettingDefinition[],
  settings: JsonObject,
): number {
  return definitions.filter((definition) => {
    const value = readSettingValue(settings, definition);
    return definition.defaultValue === undefined
      ? value !== undefined
      : value !== definition.defaultValue;
  }).length;
}

function countCustomBuiltInTools(tools: readonly AgentBuiltInToolConfig[] | undefined): number {
  if (tools === undefined) {
    return 0;
  }

  return normalizeAgentBuiltInTools(tools).filter((tool) => !tool.enabled).length;
}

function isCustomValue(
  definition: RuntimeAdvancedSettingDefinition,
  value: number | string | undefined,
): boolean {
  return definition.defaultValue === undefined
    ? value !== undefined
    : value !== definition.defaultValue;
}

function SelectSettingControl({
  definition,
  selected,
  setSetting,
}: {
  definition: Extract<RuntimeAdvancedSettingDefinition, { type: "select" }>;
  selected: number | string | undefined;
  setSetting(value: string | undefined): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
      {definition.defaultValue === undefined ? (
        <button
          aria-pressed={selected === undefined}
          className={cn(
            "min-h-8 rounded-md border px-2 text-[12px] font-medium transition-colors",
            selected === undefined
              ? "border-emphasis bg-selected text-foreground"
              : "border-border bg-card text-fg-3 hover:border-border-strong hover:text-foreground",
          )}
          onClick={() => {
            setSetting(undefined);
          }}
          type="button"
        >
          {t("agent.runtimeDefault")}
        </button>
      ) : null}

      {definition.options.map((option) => {
        const optionSelected = option.value === selected;

        return (
          <button
            aria-pressed={optionSelected}
            className={cn(
              "min-h-8 rounded-md border px-2 text-[12px] font-medium transition-colors",
              optionSelected
                ? "border-emphasis bg-selected text-foreground"
                : "border-border bg-card text-fg-3 hover:border-border-strong hover:text-foreground",
            )}
            key={option.value}
            onClick={() => {
              setSetting(option.value);
            }}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function NumberSettingControl({
  definition,
  selected,
  setSetting,
}: {
  definition: Extract<RuntimeAdvancedSettingDefinition, { type: "number" }>;
  selected: number | string | undefined;
  setSetting(value: number | undefined): void;
}) {
  const { t } = useTranslation();

  return (
    <Input
      aria-label={definition.label}
      className="max-w-40"
      min={definition.min}
      onChange={(event) => {
        const nextValue = event.target.value;

        if (nextValue === "") {
          setSetting(undefined);
          return;
        }

        const parsed = Number(nextValue);

        if (
          Number.isFinite(parsed) &&
          (definition.valueType !== "integer" || Number.isInteger(parsed)) &&
          parsed >= definition.min
        ) {
          setSetting(parsed);
        }
      }}
      placeholder={t("agent.runtimeDefault")}
      step={definition.step ?? 1}
      type="number"
      value={typeof selected === "number" ? String(selected) : ""}
    />
  );
}

export function RuntimeAdvancedSettingsField({
  builtInTools,
  modelId,
  runtimeId,
  settings,
  setBuiltInTools,
  setSettings,
}: {
  builtInTools?: AgentBuiltInToolConfig[];
  modelId: string;
  runtimeId: string;
  settings: JsonObject;
  setBuiltInTools?(tools: AgentBuiltInToolConfig[]): void;
  setSettings(settings: JsonObject): void;
}): ReactElement | null {
  const { t } = useTranslation();
  const definitions = listRuntimeAdvancedSettings(runtimeId, modelId);
  const showBuiltInTools =
    runtimeId === CLAUDE_AGENT_SDK_RUNTIME_ID &&
    builtInTools !== undefined &&
    setBuiltInTools !== undefined;
  const [open, setOpen] = useState(false);

  const toolSupportError = getAgentBuiltInToolSupportError(runtimeId, builtInTools ?? []);

  if (definitions.length === 0 && !showBuiltInTools && !toolSupportError) {
    return null;
  }

  const customCount =
    countCustomSettings(definitions, settings) + countCustomBuiltInTools(builtInTools);

  function setSetting(
    definition: RuntimeAdvancedSettingDefinition,
    value: number | string | undefined,
  ): void {
    const next = toCustomSettings(definitions, settings);

    if (!isCustomValue(definition, value) || value === undefined) {
      delete next[definition.key];
    } else {
      next[definition.key] = value;
    }

    setSettings(next);
  }

  return (
    <div className="pt-1">
      {toolSupportError ? (
        <p role="alert" className="text-danger text-[12px]">
          {toolSupportError}
        </p>
      ) : null}
      <button
        aria-expanded={open}
        className="text-fg-3 hover:text-foreground flex items-center gap-1 text-[12px] transition"
        onClick={() => {
          setOpen((current) => !current);
        }}
        type="button"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        <span>{t("agent.advancedRuntimeSettings")}</span>
        {customCount > 0 ? (
          <span className="border-border bg-sunken text-fg-3 ml-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none">
            {t("agentEditor.customCount", { count: String(customCount) })}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="border-border bg-sunken/30 mt-3 space-y-4 rounded-md border p-3">
          <p className="text-fg-3 text-[11px] leading-relaxed">
            {t("agentEditor.runtimeSettingsNotPortable")}
          </p>

          {definitions.map((definition) => {
            const selected = readSettingValue(settings, definition);

            return (
              <div className="space-y-1.5" key={definition.key}>
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-fg-3 text-[12px]">{definition.label}</Label>
                  <span className="text-fg-3 text-[10px]">{definition.key}</span>
                </div>
                {definition.type === "select" ? (
                  <SelectSettingControl
                    definition={definition}
                    selected={selected}
                    setSetting={(value) => {
                      setSetting(definition, value);
                    }}
                  />
                ) : (
                  <NumberSettingControl
                    definition={definition}
                    selected={selected}
                    setSetting={(value) => {
                      setSetting(definition, value);
                    }}
                  />
                )}
              </div>
            );
          })}

          {showBuiltInTools ? (
            <div className="border-border/70 space-y-2 border-t pt-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-fg-3 text-[12px]">{t("agentEditor.tools")}</Label>
                <span className="text-fg-3 text-[10px]">tools</span>
              </div>
              <BuiltInToolsField tools={builtInTools} setTools={setBuiltInTools} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
