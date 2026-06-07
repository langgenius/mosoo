import { parseAgentBuilderPlannerOutputJson } from "@mosoo/contracts/agent-builder";
import type {
  AgentBuilderDraftPatchChange,
  AgentBuilderDraftPatchSectionId,
  AgentBuilderDraftPatchValue,
  AgentBuilderPlanNodeAction,
  AgentBuilderPlanNode,
} from "@mosoo/contracts/agent-builder";
import { ArrowRight } from "lucide-react";
import type { ReactElement } from "react";

import { isAgentBuilderStreamingMessage } from "@/domains/agent-builder/api/agent-builder-chat-transport";
import type { AgentBuilderMessage } from "@/domains/agent-builder/api/agent-builder-client";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Markdown } from "@/shared/ui/markdown";

import { AgentBuilderAskUserCard } from "./agent-builder-ask-user-card";
import type { AgentBuilderStructuredReply } from "./agent-builder-ask-user-card";
import { AgentBuilderStreamingText, BuilderStreamCaret } from "./agent-builder-streaming-text";
import { getEnvironmentConfigLink } from "./environment-config-link";

export type AgentBuilderActionDisabled = boolean | ((actionKey: string) => boolean);

function isAgentBuilderActionDisabled(
  actionDisabled: AgentBuilderActionDisabled,
  actionKey: string,
): boolean {
  return typeof actionDisabled === "function" ? actionDisabled(actionKey) : actionDisabled;
}

function isOptimisticAgentBuilderMessage(message: AgentBuilderMessage): boolean {
  return isAgentBuilderStreamingMessage(message);
}

export function AgentBuilderMessageCard({
  message,
  onAction,
  onDraftPatchFocus,
  onStructuredReply,
  actionDisabled,
  structuredReplyDisabled,
}: {
  message: AgentBuilderMessage;
  onAction?: ((actionKey: string) => void) | undefined;
  onDraftPatchFocus?: ((sectionId: AgentBuilderDraftPatchSectionId) => void) | undefined;
  onStructuredReply?: ((reply: AgentBuilderStructuredReply) => void) | undefined;
  actionDisabled: AgentBuilderActionDisabled;
  structuredReplyDisabled: boolean;
}): ReactElement {
  const isUser = message.role === "user";
  const isStreaming = message.role === "assistant" && isOptimisticAgentBuilderMessage(message);

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0 max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed break-words",
          isUser
            ? "bg-brand-light text-foreground rounded-tr-md"
            : "border-border-subtle w-full rounded-tl-md border bg-white",
        )}
      >
        <AgentBuilderMessageBody isStreaming={isStreaming} message={message} />
        {isStreaming ? null : (
          <PlannerOutputSurface
            cardsJson={message.cardsJson}
            onAction={onAction}
            onDraftPatchFocus={onDraftPatchFocus}
            onStructuredReply={onStructuredReply}
            actionDisabled={actionDisabled}
            structuredReplyDisabled={structuredReplyDisabled}
          />
        )}
      </div>
    </div>
  );
}

function AgentBuilderMessageBody({
  isStreaming,
  message,
}: {
  isStreaming: boolean;
  message: AgentBuilderMessage;
}): ReactElement {
  if (message.role !== "assistant") {
    return (
      <div className="text-foreground break-words whitespace-pre-wrap">{message.contentText}</div>
    );
  }

  if (isStreaming) {
    return <AgentBuilderStreamingText text={message.contentText} />;
  }

  if (message.contentText.trim().length === 0) {
    return <BuilderStreamCaret />;
  }

  return (
    <Markdown className="mt-1.5 space-y-2 text-[12px] leading-relaxed break-words">
      {message.contentText}
    </Markdown>
  );
}

function formatDraftPatchValue(value: AgentBuilderDraftPatchValue): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value ?? "None";
}

const DRAFT_PATCH_FIELD_LABELS: Record<AgentBuilderDraftPatchChange["fieldPath"], string> = {
  "componentDecisions.environment": "Environment decision",
  description: "Description",
  environmentId: "Environment",
  kind: "Agent type",
  mcpServerIds: "MCP Servers",
  model: "Model",
  name: "Name",
  prompt: "System Prompt",
  provider: "Provider",
  runtimeId: "Runtime",
  skillIds: "Skills",
  spaceIds: "Spaces",
};

function getDraftPatchFieldLabel(fieldPath: AgentBuilderDraftPatchChange["fieldPath"]): string {
  return DRAFT_PATCH_FIELD_LABELS[fieldPath];
}

function normalizeInlinePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatPromptPreview(value: string): string {
  const normalized = normalizeInlinePreview(value);
  const maxPreviewLength = 150;

  return normalized.length > maxPreviewLength
    ? `${normalized.slice(0, maxPreviewLength).trim()}...`
    : normalized;
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function getNodeFieldLabel(node: AgentBuilderPlanNode): string | null {
  if (node.draftPatch !== undefined) {
    return getDraftPatchFieldLabel(node.draftPatch.fieldPath);
  }

  return null;
}

function planNodeStatusBadgeVariant(
  status: AgentBuilderPlanNode["status"],
): "danger" | "success" | "warning" {
  switch (status) {
    case "applied":
      return "success";
    case "blocked":
    case "failed":
      return "danger";
    case "pending":
      return "warning";
  }
}

function planNodeActionButtonVariant(
  style: AgentBuilderPlanNodeAction["style"],
): "default" | "destructive" | "outline" {
  switch (style) {
    case "danger":
      return "destructive";
    case "secondary":
      return "outline";
    case "primary":
      return "default";
  }
}

function DraftPatchValuePreview({
  draftPatch,
  onDraftPatchFocus,
}: {
  draftPatch: AgentBuilderDraftPatchChange;
  onDraftPatchFocus?: ((sectionId: AgentBuilderDraftPatchSectionId) => void) | undefined;
}): ReactElement {
  const fieldLabel = getDraftPatchFieldLabel(draftPatch.fieldPath);
  const environmentConfigLink = getEnvironmentConfigLink(draftPatch);
  const canFocus =
    draftPatch.sectionId !== undefined &&
    onDraftPatchFocus !== undefined &&
    environmentConfigLink === null;
  const containerClassName =
    "border-border-subtle text-muted-foreground mt-2 w-full border-t pt-2 text-left";

  const content =
    draftPatch.fieldPath === "prompt" && typeof draftPatch.value === "string" ? (
      <div className="space-y-1">
        <div className="text-muted-foreground text-[11px] leading-none font-semibold tracking-wide uppercase">
          {fieldLabel}
        </div>
        <div className="text-muted-foreground line-clamp-2 text-[12px] leading-relaxed break-words">
          {formatPromptPreview(draftPatch.value)}
        </div>
        <div className="text-muted-foreground text-[11px] leading-relaxed">
          {countCharacters(draftPatch.value)} characters
          {canFocus ? " · Click to view the full prompt in the editor" : ""}
        </div>
      </div>
    ) : (
      <div className="space-y-1">
        <div className="text-muted-foreground text-[11px] leading-none font-semibold tracking-wide uppercase">
          {fieldLabel}
        </div>
        <div className="text-muted-foreground line-clamp-2 text-[12px] leading-relaxed break-words">
          {formatDraftPatchValue(draftPatch.value)}
        </div>
        {environmentConfigLink === null ? null : (
          <a
            className="text-fg-1 hover:text-fg-2 inline-flex max-w-full flex-wrap text-[11px] leading-relaxed font-semibold break-words whitespace-normal"
            href={environmentConfigLink.href}
          >
            配置环境变量
            {environmentConfigLink.environmentName === null
              ? ""
              : ` · ${environmentConfigLink.environmentName}`}
          </a>
        )}
      </div>
    );

  if (!canFocus) {
    return <div className={containerClassName}>{content}</div>;
  }

  return (
    <button
      className={`${containerClassName} hover:text-foreground`}
      onClick={() => {
        if (draftPatch.sectionId !== undefined) {
          onDraftPatchFocus?.(draftPatch.sectionId);
        }
      }}
      type="button"
    >
      {content}
    </button>
  );
}

function PlannerNodeCard({
  node,
  onAction,
  onDraftPatchFocus,
  onStructuredReply,
  actionDisabled,
  structuredReplyDisabled,
}: {
  node: AgentBuilderPlanNode;
  onAction?: ((actionKey: string) => void) | undefined;
  onDraftPatchFocus?: ((sectionId: AgentBuilderDraftPatchSectionId) => void) | undefined;
  onStructuredReply?: ((reply: AgentBuilderStructuredReply) => void) | undefined;
  actionDisabled: AgentBuilderActionDisabled;
  structuredReplyDisabled: boolean;
}): ReactElement {
  const fieldLabel = getNodeFieldLabel(node);

  return (
    <div className="bg-bg-1 rounded-md p-2.5 text-left">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant={planNodeStatusBadgeVariant(node.status)}>{node.status}</Badge>
          {fieldLabel === null ? null : (
            <span className="text-foreground text-[12px] leading-none font-semibold">
              {fieldLabel}
            </span>
          )}
        </div>
        <div className="text-foreground mt-2 text-[13px] leading-relaxed font-medium break-words">
          {node.summary}
        </div>
        {node.draftPatch ? (
          <DraftPatchValuePreview
            draftPatch={node.draftPatch}
            onDraftPatchFocus={onDraftPatchFocus}
          />
        ) : null}
        {node.askUser === undefined || onStructuredReply === undefined ? null : (
          <AgentBuilderAskUserCard
            disabled={structuredReplyDisabled}
            nodeKey={node.nodeKey}
            onSubmit={onStructuredReply}
            question={node.askUser}
          />
        )}
        {node.actions.length === 0 ? null : (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {node.actions.map((action) => (
              <Button
                disabled={
                  isAgentBuilderActionDisabled(actionDisabled, action.actionKey) ||
                  onAction === undefined
                }
                key={action.actionKey}
                onClick={() => {
                  onAction?.(action.actionKey);
                }}
                size="sm"
                type="button"
                variant={planNodeActionButtonVariant(action.style)}
              >
                {action.label}
                <ArrowRight />
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlannerOutputSurface({
  cardsJson,
  onAction,
  onDraftPatchFocus,
  onStructuredReply,
  actionDisabled,
  structuredReplyDisabled,
}: {
  cardsJson: string | null;
  onAction?: ((actionKey: string) => void) | undefined;
  onDraftPatchFocus?: ((sectionId: AgentBuilderDraftPatchSectionId) => void) | undefined;
  onStructuredReply?: ((reply: AgentBuilderStructuredReply) => void) | undefined;
  actionDisabled: AgentBuilderActionDisabled;
  structuredReplyDisabled: boolean;
}): ReactElement | null {
  if (cardsJson === null) {
    return null;
  }

  const output = parseAgentBuilderPlannerOutputJson(cardsJson);

  if (output === null || output.nodes.length === 0) {
    return null;
  }

  return (
    <div className="border-border-subtle mt-2.5 space-y-2 border-t pt-2.5">
      {output.nodes.map((node) => (
        <PlannerNodeCard
          key={node.nodeKey}
          node={node}
          onAction={onAction}
          onDraftPatchFocus={onDraftPatchFocus}
          onStructuredReply={onStructuredReply}
          actionDisabled={actionDisabled}
          structuredReplyDisabled={structuredReplyDisabled}
        />
      ))}
    </div>
  );
}
