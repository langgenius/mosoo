import type { JsonObject } from "@mosoo/contracts";
import type { AgentBuiltInToolConfig } from "@mosoo/contracts/agent";
import { normalizeAgentBuiltInTools } from "@mosoo/contracts/agent";
import type { RuntimeAdvancedSettingDefinition } from "@mosoo/runtime-catalog";
import { listRuntimeAdvancedSettings } from "@mosoo/runtime-catalog";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
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
  readOnly,
  selected,
  setSetting,
}: {
  definition: Extract<RuntimeAdvancedSettingDefinition, { type: "select" }>;
  readOnly: boolean;
  selected: number | string | undefined;
  setSetting(value: string | undefined): void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
      {definition.defaultValue === undefined ? (
        <button
          aria-pressed={selected === undefined}
          className={cn(
            "min-h-8 rounded-md border px-2 text-[12px] font-medium transition-colors",
            selected === undefined
              ? "border-brand bg-brand-light text-foreground"
              : "border-border bg-white text-muted-foreground hover:border-brand/30 hover:text-foreground",
            readOnly ? "pointer-events-none opacity-60" : null,
          )}
          disabled={readOnly}
          onClick={() => {
            setSetting(undefined);
          }}
          type="button"
        >
          Runtime default
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
                ? "border-brand bg-brand-light text-foreground"
                : "border-border bg-white text-muted-foreground hover:border-brand/30 hover:text-foreground",
              readOnly ? "pointer-events-none opacity-60" : null,
            )}
            disabled={readOnly}
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
  readOnly,
  selected,
  setSetting,
}: {
  definition: Extract<RuntimeAdvancedSettingDefinition, { type: "number" }>;
  readOnly: boolean;
  selected: number | string | undefined;
  setSetting(value: number | undefined): void;
}) {
  return (
    <Input
      aria-label={definition.label}
      className="max-w-40"
      disabled={readOnly}
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
      placeholder="Runtime default"
      readOnly={readOnly}
      step={definition.step ?? 1}
      type="number"
      value={typeof selected === "number" ? String(selected) : ""}
    />
  );
}

export function RuntimeAdvancedSettingsField({
  builtInTools,
  readOnly,
  runtimeId,
  settings,
  setBuiltInTools,
  setSettings,
}: {
  builtInTools?: AgentBuiltInToolConfig[];
  readOnly: boolean;
  runtimeId: string;
  settings: JsonObject;
  setBuiltInTools?(tools: AgentBuiltInToolConfig[]): void;
  setSettings(settings: JsonObject): void;
}): ReactElement | null {
  const definitions = listRuntimeAdvancedSettings(runtimeId);
  const showBuiltInTools =
    runtimeId === CLAUDE_AGENT_SDK_RUNTIME_ID &&
    builtInTools !== undefined &&
    setBuiltInTools !== undefined;
  const [open, setOpen] = useState(false);

  if (definitions.length === 0 && !showBuiltInTools) {
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
      <button
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[12px] transition"
        onClick={() => {
          setOpen((current) => !current);
        }}
        type="button"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        <span>Advanced runtime settings</span>
        {customCount > 0 ? (
          <span className="border-border bg-muted text-muted-foreground ml-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none">
            {customCount} custom
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="border-border bg-muted/30 mt-3 space-y-4 rounded-md border p-3">
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            Runtime-specific settings. These settings are not portable across runtimes.
          </p>

          {definitions.map((definition) => {
            const selected = readSettingValue(settings, definition);

            return (
              <div className="space-y-1.5" key={definition.key}>
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-muted-foreground text-[12px]">{definition.label}</Label>
                  <span className="text-muted-foreground text-[10px]">{definition.key}</span>
                </div>
                {definition.type === "select" ? (
                  <SelectSettingControl
                    definition={definition}
                    readOnly={readOnly}
                    selected={selected}
                    setSetting={(value) => {
                      setSetting(definition, value);
                    }}
                  />
                ) : (
                  <NumberSettingControl
                    definition={definition}
                    readOnly={readOnly}
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
                <Label className="text-muted-foreground text-[12px]">Tools</Label>
                <span className="text-muted-foreground text-[10px]">tools</span>
              </div>
              <BuiltInToolsField
                readOnly={readOnly}
                tools={builtInTools}
                setTools={setBuiltInTools}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
