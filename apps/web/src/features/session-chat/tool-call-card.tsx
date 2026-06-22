import { ChevronRight, Loader2, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";

import { isTruthy } from "../../shared/lib/truthiness";
export interface ToolCall {
  approvalInput?: string | null;
  argsText: string;
  output?: string;
  path: string | null;
  status: "running" | "needs_approval" | "completed";
  tool: string;
}

export interface ToolCallCardProps {
  call: ToolCall;
}

export function ToolCallCard({ call }: ToolCallCardProps): ReactElement {
  const inputText = call.argsText.trim().length > 0 ? call.argsText : (call.approvalInput ?? "");
  const hasInput = inputText.trim().length > 0;
  const hasOutput = call.output !== undefined && call.output.length > 0;
  const isCompleted = call.status === "completed";
  const statusLabel =
    call.status === "completed"
      ? "done"
      : call.status === "needs_approval"
        ? "needs approval"
        : "running";

  return (
    <details
      className="group border-border-soft bg-paper-50 text-fg-2 rounded-md border px-2.5 py-1.5 text-[12px]"
      data-testid="session-tool-call-card"
    >
      <summary className="flex min-w-0 cursor-pointer items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="text-fg-3 size-3.5 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden
        />
        {call.status === "running" ? (
          <Loader2 className="text-accent size-3.5 shrink-0 animate-spin" aria-hidden />
        ) : call.status === "needs_approval" ? (
          <ShieldAlert className="text-amber size-3.5 shrink-0" aria-hidden />
        ) : null}
        <span className="text-fg-1 min-w-0 truncate font-mono font-semibold">{call.tool}</span>
        {isTruthy(call.path) ? (
          <span className="text-fg-3 truncate font-mono" title={call.path}>
            {call.path}
          </span>
        ) : null}
        <span className="text-fg-3 ml-auto shrink-0 text-[10.5px] font-semibold tracking-wide uppercase">
          {statusLabel}
        </span>
      </summary>
      {hasOutput || hasInput ? (
        <div className="mt-1.5 space-y-1.5">
          {hasInput ? (
            <pre className="bg-paper-200 max-h-48 overflow-auto rounded-sm p-2 font-mono text-[11.5px] leading-snug break-words whitespace-pre-wrap">
              {inputText}
            </pre>
          ) : null}
          {hasOutput ? (
            <pre className="bg-paper-200 max-h-48 overflow-auto rounded-sm p-2 font-mono text-[11.5px] leading-snug break-words whitespace-pre-wrap">
              {call.output}
            </pre>
          ) : null}
        </div>
      ) : isCompleted ? (
        <div className="mt-1.5 space-y-1.5">
          <p className="bg-paper-200 text-fg-3 rounded-sm p-2 font-mono text-[11.5px] leading-snug italic">
            (no output)
          </p>
        </div>
      ) : (
        <p className="bg-paper-200 text-fg-3 mt-1.5 rounded-sm p-2 font-mono text-[11.5px] leading-snug italic">
          Waiting for tool input or output.
        </p>
      )}
    </details>
  );
}
