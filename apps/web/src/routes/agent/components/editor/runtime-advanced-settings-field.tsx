import type { JsonObject } from "@mosoo/contracts";
import type { RuntimeAdvancedSettingDefinition } from "@mosoo/runtime-catalog";
import { listRuntimeAdvancedSettings } from "@mosoo/runtime-catalog";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Label } from "@/shared/ui/label";

function readSettingValue(
  settings: JsonObject,
  definition: RuntimeAdvancedSettingDefinition,
): string {
  const value = settings[definition.key];

  if (typeof value === "string" && definition.options.some((option) => option.value === value)) {
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

    if (value !== definition.defaultValue) {
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
    return value !== definition.defaultValue;
  }).length;
}

export function RuntimeAdvancedSettingsField({
  readOnly,
  runtimeId,
  settings,
  setSettings,
}: {
  readOnly: boolean;
  runtimeId: string;
  settings: JsonObject;
  setSettings(settings: JsonObject): void;
}): ReactElement | null {
  const definitions = listRuntimeAdvancedSettings(runtimeId);
  const [open, setOpen] = useState(false);

  if (definitions.length === 0) {
    return null;
  }

  const customCount = countCustomSettings(definitions, settings);

  function setSetting(definition: RuntimeAdvancedSettingDefinition, value: string): void {
    const next = toCustomSettings(definitions, settings);

    if (value === definition.defaultValue) {
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
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
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
                          setSetting(definition, option.value);
                        }}
                        type="button"
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
