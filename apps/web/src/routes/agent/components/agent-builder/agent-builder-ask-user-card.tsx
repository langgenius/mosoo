import type { AgentBuilderAskUserQuestion } from "@mosoo/contracts/agent-builder";
import { Check, SendHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";

export interface AgentBuilderStructuredReply {
  customText: string | null;
  mode: AgentBuilderAskUserQuestion["mode"];
  nodeKey: string;
  selectedOptionKeys: string[];
  skipped: boolean;
}

function toggleKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key];
}

function buildReplyPayload(reply: AgentBuilderStructuredReply): string {
  return JSON.stringify(
    {
      customText: reply.customText,
      mode: reply.mode,
      nodeKey: reply.nodeKey,
      selectedOptionKeys: reply.selectedOptionKeys,
      skipped: reply.skipped,
      type: "agent_builder_structured_input",
    },
    null,
    2,
  );
}

export function createAgentBuilderStructuredReplyText(reply: AgentBuilderStructuredReply): string {
  return buildReplyPayload(reply);
}

export function AgentBuilderAskUserCard({
  disabled,
  nodeKey,
  onSubmit,
  question,
}: {
  disabled: boolean;
  nodeKey: string;
  onSubmit: (reply: AgentBuilderStructuredReply) => void;
  question: AgentBuilderAskUserQuestion;
}): ReactElement {
  const [customText, setCustomText] = useState("");
  const [selectedOptionKeys, setSelectedOptionKeys] = useState<string[]>([]);
  const trimmedCustomText = customText.trim();
  const isFreeText = question.mode === "free_text";
  const canSubmit = useMemo(() => {
    if (disabled) {
      return false;
    }

    if (isFreeText) {
      return trimmedCustomText.length > 0;
    }

    return selectedOptionKeys.length > 0 || trimmedCustomText.length > 0;
  }, [disabled, isFreeText, selectedOptionKeys.length, trimmedCustomText.length]);

  const submit = (skipped: boolean) => {
    if (!skipped && !canSubmit) {
      return;
    }

    onSubmit({
      customText: trimmedCustomText.length === 0 ? null : trimmedCustomText,
      mode: question.mode,
      nodeKey,
      selectedOptionKeys: skipped ? [] : selectedOptionKeys,
      skipped,
    });
  };

  const selectOption = (optionKey: string) => {
    if (disabled) {
      return;
    }

    setSelectedOptionKeys((current) =>
      question.mode === "multi_select" ? toggleKey(current, optionKey) : [optionKey],
    );
  };

  return (
    <div className="border-border-subtle bg-bg-1 mt-2.5 overflow-hidden rounded-lg border">
      <div className="border-border-subtle border-b px-3 py-2.5">
        <div className="text-foreground text-[13px] leading-relaxed font-semibold">
          {question.prompt}
        </div>
      </div>

      {isFreeText ? null : (
        <div className="divide-border-subtle divide-y">
          {question.options.map((option) => {
            const selected = selectedOptionKeys.includes(option.optionKey);

            return (
              <button
                className={cn(
                  "hover:bg-bg-2 flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                  selected ? "bg-bg-2" : "bg-transparent",
                )}
                disabled={disabled}
                key={option.optionKey}
                onClick={() => selectOption(option.optionKey)}
                type="button"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border",
                    selected
                      ? "border-brand bg-brand text-white"
                      : "border-border bg-white text-transparent",
                  )}
                >
                  <Check className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="text-foreground block text-[13px] leading-relaxed font-medium">
                    {option.label}
                  </span>
                  {option.description === undefined ? null : (
                    <span className="text-muted-foreground mt-0.5 block text-[11px] leading-relaxed">
                      {option.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {question.allowCustomText || isFreeText ? (
        <div className="border-border-subtle border-t p-3">
          <Textarea
            className="min-h-20 resize-none text-[12px]"
            disabled={disabled}
            maxLength={2000}
            onChange={(event) => setCustomText(event.target.value)}
            placeholder={isFreeText ? "Type your answer..." : "Something else..."}
            value={customText}
          />
        </div>
      ) : null}

      <div className="border-border-subtle flex items-center justify-end gap-2 border-t px-3 py-2.5">
        {question.allowSkip ? (
          <Button
            disabled={disabled}
            onClick={() => submit(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            Skip
          </Button>
        ) : null}
        <Button disabled={!canSubmit} onClick={() => submit(false)} size="icon-sm" type="button">
          <SendHorizontal />
        </Button>
      </div>
    </div>
  );
}
