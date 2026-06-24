import { ComposerPrimitive, ThreadPrimitive } from "@assistant-ui/react";
import { ArrowUp, FileText, Paperclip } from "lucide-react";
import type React from "react";
import type { ReactElement } from "react";

import type { ComposerError } from "@/routes/agent/components/agent-session-panel-model-types";
import { cn } from "@/shared/lib/class-names";
import { isTruthy } from "@/shared/lib/truthiness";
import { Button } from "@/shared/ui/button";

import type { SessionResourceMention } from "../session-resource-mentions";

interface PendingSessionFileChip {
  id: string;
  name: string;
  progress?: number;
  status: "failed" | "uploading";
}

interface SessionThreadComposerProps {
  composerError: ComposerError | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFilesSelected: (files: File[]) => void;
  onRetry: () => void;
  pendingSessionFiles: PendingSessionFileChip[];
  sendDisabledReason?: string | null;
  sessionResourceMentions: SessionResourceMention[];
  showSendDisabledReason?: boolean;
}

function SessionResourceChips({
  mentions,
  pendingFiles,
}: {
  mentions: SessionResourceMention[];
  pendingFiles: PendingSessionFileChip[];
}): ReactElement | null {
  if (mentions.length === 0 && pendingFiles.length === 0) {
    return null;
  }

  return (
    <div className="mx-3 mt-3 flex flex-wrap gap-1.5">
      {pendingFiles.map((file) => (
        <span
          key={file.id}
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
            file.status === "failed"
              ? "border-destructive/25 bg-destructive/[0.04] text-destructive"
              : "border-border bg-muted/35 text-fg-2",
          )}
          title={file.name}
        >
          <FileText className="size-3 shrink-0" />
          <span className="max-w-[180px] truncate font-medium">{file.name}</span>
          <span className="text-fg-3 shrink-0">
            {file.status === "failed" ? "failed" : `${Math.round(file.progress ?? 0)}%`}
          </span>
        </span>
      ))}
      {mentions.map((mention) => (
        <span
          key={mention.id}
          className="border-border bg-muted/35 text-fg-2 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
          title={`${mention.name} @${mention.path}`}
        >
          <FileText className="text-fg-3 size-3 shrink-0" />
          <span className="max-w-[220px] truncate font-mono">@{mention.path}</span>
        </span>
      ))}
    </div>
  );
}

// Composer rebuilt on assistant-ui's ComposerPrimitive. Slim single-line input
// that grows; submit/cancel + Enter / Shift+Enter come from the primitive. The
// Mosoo upload button, resource-mention chips, and error card are preserved as
// custom children. The mention pipeline runs in onNew/onSend (see
// agent-session-panel), so this composer only collects the typed text.
export function SessionThreadComposer({
  composerError,
  fileInputRef,
  onFilesSelected,
  onRetry,
  pendingSessionFiles,
  sendDisabledReason,
  sessionResourceMentions,
  showSendDisabledReason = true,
}: SessionThreadComposerProps): ReactElement {
  return (
    <ComposerPrimitive.Root
      className={cn("border-border-strong bg-card rounded-lg border")}
      style={{ boxShadow: "var(--shadow-md)" }}
    >
      {composerError ? (
        <div className="border-destructive/20 bg-destructive/[0.06] text-destructive mx-3 mt-3 rounded-md border px-3 py-2 text-[13px]">
          <div>{composerError.message}</div>
          {composerError.retryable ? (
            <button
              type="button"
              onClick={onRetry}
              className="text-destructive mt-1 text-[12px] font-semibold underline underline-offset-4"
            >
              {composerError.actionLabel ?? "Retry"}
            </button>
          ) : null}
        </div>
      ) : null}

      {showSendDisabledReason && isTruthy(sendDisabledReason) ? (
        <div className="border-border bg-muted/40 text-fg-2 mx-3 mt-3 rounded-md border px-3 py-2 text-[13px]">
          {sendDisabledReason}
        </div>
      ) : null}

      <SessionResourceChips mentions={sessionResourceMentions} pendingFiles={pendingSessionFiles} />

      <ComposerPrimitive.Input
        submitOnEnter
        minRows={1}
        maxRows={8}
        placeholder="Describe a task for the agent…"
        className="text-fg-1 placeholder:text-fg-muted w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14.5px] leading-[1.5] outline-none"
        data-testid="agent-session-composer-input"
        aria-label="Describe a task for the agent"
      />

      <div className="flex items-center justify-between px-2 pb-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          aria-label="Attach files"
          onChange={(event) => {
            if (event.target.files) {
              onFilesSelected([...event.target.files]);
            }

            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-fg-3 rounded-full"
          onClick={() => {
            fileInputRef.current?.click();
          }}
          aria-label="Attach file"
        >
          <Paperclip className="size-4" />
        </Button>

        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send asChild>
            <Button
              type="button"
              size="icon-sm"
              className="rounded-full"
              aria-label="Send"
              data-testid="agent-session-send"
            >
              <ArrowUp className="size-4" />
            </Button>
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>

        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              size="icon-sm"
              className="rounded-full"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <span aria-hidden className="size-2.5 rounded-[2px] bg-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </div>
    </ComposerPrimitive.Root>
  );
}
