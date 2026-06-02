import { CornerDownLeft, FileText, Paperclip } from "lucide-react";
import type React from "react";

import { cn } from "@/shared/lib/class-names";

import { isTruthy } from "../../shared/lib/truthiness";
import type { SessionResourceMention } from "./session-resource-mentions";
interface SessionComposerError {
  actionLabel?: string | null;
  message: string;
  retryable: boolean;
}

interface SessionComposerProps {
  composerError: SessionComposerError | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  input: string;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onFilesSelected: (files: File[]) => void;
  onSend: () => void;
  pendingSessionFiles: PendingSessionFileChip[];
  sendDisabledReason?: string | null;
  sending: boolean;
  sessionResourceMentions: SessionResourceMention[];
  setInput: (value: string) => void;
  streaming: boolean;
}

interface PendingSessionFileChip {
  id: string;
  name: string;
  progress?: number;
  status: "failed" | "uploading";
}

function SessionResourceChips({
  mentions,
  pendingFiles,
}: {
  mentions: SessionResourceMention[];
  pendingFiles: PendingSessionFileChip[];
}) {
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

export function SessionComposer({
  composerError,
  fileInputRef,
  input,
  inputRef,
  onKeyDown,
  onFilesSelected,
  onSend,
  pendingSessionFiles,
  sendDisabledReason,
  sending,
  sessionResourceMentions,
  setInput,
  streaming,
}: SessionComposerProps) {
  const sendDisabled = !input.trim() || Boolean(sendDisabledReason) || sending || streaming;

  return (
    <div
      className={cn("rounded-xl border border-border-strong bg-card")}
      style={{ boxShadow: "var(--shadow-md)" }}
    >
      {composerError ? (
        <div className="border-destructive/20 bg-destructive/[0.06] text-destructive mx-3 mt-3 rounded-md border px-3 py-2 text-[13px]">
          <div>{composerError.message}</div>
          {composerError.retryable ? (
            <button
              type="button"
              onClick={onSend}
              className="text-destructive mt-1 text-[12px] font-semibold underline underline-offset-4"
            >
              {composerError.actionLabel ?? "Retry"}
            </button>
          ) : null}
        </div>
      ) : null}

      {isTruthy(sendDisabledReason) ? (
        <div className="border-border bg-muted/40 text-fg-2 mx-3 mt-3 rounded-md border px-3 py-2 text-[13px]">
          {sendDisabledReason}
        </div>
      ) : null}

      <SessionResourceChips mentions={sessionResourceMentions} pendingFiles={pendingSessionFiles} />

      <textarea
        ref={inputRef}
        value={input}
        onChange={(event) => {
          setInput(event.target.value);
          event.target.style.height = "auto";
          event.target.style.height = `${Math.min(event.target.scrollHeight, 200)}px`;
        }}
        onKeyDown={onKeyDown}
        placeholder="Describe a task for the agent…"
        rows={3}
        className="text-fg-1 placeholder:text-fg-muted w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[15px] leading-[1.5] outline-none"
        data-testid="agent-session-composer-input"
        aria-label="Describe a task for the agent"
      />

      <div className="flex items-center justify-between px-2.5 pb-2.5">
        <div className="flex items-center gap-0.5">
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
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-fg-3 hover:bg-ink-900/[0.05] hover:text-fg-1 inline-flex size-7 items-center justify-center rounded-md transition-colors"
            aria-label="Attach file"
          >
            <Paperclip className="size-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={onSend}
          disabled={sendDisabled}
          className="text-fg-3 hover:bg-ink-900/[0.05] hover:text-fg-1 inline-flex size-8 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send"
          data-testid="agent-session-send"
        >
          <CornerDownLeft className="size-4" />
        </button>
      </div>
    </div>
  );
}
