import { ChevronRight, Loader2 } from "lucide-react";
import type { ReactElement } from "react";

import { isTruthy } from "../../shared/lib/truthiness";
export interface ToolCall {
  argsText: string;
  output?: string;
  path: string | null;
  status: "running" | "completed";
  tool: string;
}

export interface ToolCallCardProps {
  call: ToolCall;
}

// Single tool-call row.
// Running calls show a spinner; completed calls collapse into `<details>`.
// Empty-output calls still render a placeholder so every row keeps the same affordance.
export function ToolCallCard({ call }: ToolCallCardProps): ReactElement {
  const hasArgs = call.argsText.trim().length > 0;

  if (call.status === "running") {
    return (
      <details
        className="border-border-soft bg-paper-50 text-fg-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px]"
        data-testid="session-tool-call-card"
      >
        <summary className="flex min-w-0 cursor-pointer items-center gap-2 [&::-webkit-details-marker]:hidden">
          <Loader2 className="text-accent size-3.5 shrink-0 animate-spin" aria-hidden />
          <span className="text-fg-1 font-mono font-semibold">{call.tool}</span>
          {isTruthy(call.path) ? (
            <span className="text-fg-3 truncate font-mono" title={call.path}>
              {call.path}
            </span>
          ) : null}
        </summary>
        {hasArgs ? (
          <pre className="bg-paper-200 mt-1.5 max-h-48 overflow-auto rounded-sm p-2 font-mono text-[11.5px] leading-snug break-words whitespace-pre-wrap">
            {call.argsText}
          </pre>
        ) : null}
      </details>
    );
  }

  const hasOutput = call.output !== undefined && call.output.length > 0;

  return (
    <details
      className="group border-border-soft bg-paper-50 text-fg-2 rounded-md border px-2.5 py-1.5 text-[12px]"
      data-testid="session-tool-call-card"
    >
      <summary className="flex cursor-pointer items-center gap-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="text-fg-3 size-3.5 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden
        />
        <span className="text-fg-1 font-mono font-semibold">{call.tool}</span>
        {isTruthy(call.path) ? (
          <span className="text-fg-3 truncate font-mono" title={call.path}>
            {call.path}
          </span>
        ) : null}
        <span className="text-fg-3 ml-auto text-[10.5px] font-semibold tracking-wide uppercase">
          done
        </span>
      </summary>
      {hasOutput ? (
        <div className="mt-1.5 space-y-1.5">
          {hasArgs ? (
            <pre className="bg-paper-200 max-h-48 overflow-auto rounded-sm p-2 font-mono text-[11.5px] leading-snug break-words whitespace-pre-wrap">
              {call.argsText}
            </pre>
          ) : null}
          <pre className="bg-paper-200 max-h-48 overflow-auto rounded-sm p-2 font-mono text-[11.5px] leading-snug break-words whitespace-pre-wrap">
            {call.output}
          </pre>
        </div>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          {hasArgs ? (
            <pre className="bg-paper-200 max-h-48 overflow-auto rounded-sm p-2 font-mono text-[11.5px] leading-snug break-words whitespace-pre-wrap">
              {call.argsText}
            </pre>
          ) : null}
          <p className="bg-paper-200 text-fg-3 rounded-sm p-2 font-mono text-[11.5px] leading-snug italic">
            (no output)
          </p>
        </div>
      )}
    </details>
  );
}
