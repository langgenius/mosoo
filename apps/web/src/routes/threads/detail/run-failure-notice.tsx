import type { SessionRunStatus, SessionRunSummary } from "@mosoo/contracts/session-run";
import { ChevronRight, CircleX } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button";

interface ThreadRunFailureDetails {
  code: string | null;
  message: string;
  title: string;
}

const FAILURE_STATUSES = new Set<SessionRunStatus>(["cancelled", "expired", "failed"]);

function getFailureFallback(
  status: SessionRunStatus,
): Pick<ThreadRunFailureDetails, "message" | "title"> {
  switch (status) {
    case "cancelled": {
      return {
        message: "The run was cancelled before it completed.",
        title: "Run cancelled",
      };
    }
    case "expired": {
      return {
        message: "The run expired before it completed.",
        title: "Run expired",
      };
    }
    default: {
      return {
        message: "The run failed before an error message was recorded.",
        title: "Run failed",
      };
    }
  }
}

export function getThreadRunFailure(run: SessionRunSummary | null): ThreadRunFailureDetails | null {
  if (run === null || !FAILURE_STATUSES.has(run.status)) {
    return null;
  }

  const fallback = getFailureFallback(run.status);
  const errorMessage = run.error?.message.trim() ?? "";

  return {
    code: run.error?.code ?? null,
    message: errorMessage.length > 0 ? errorMessage : fallback.message,
    title: fallback.title,
  };
}

export function ThreadRunFailureNotice({
  onOpenProcess,
  run,
}: {
  onOpenProcess: () => void;
  run: SessionRunSummary | null;
}): ReactElement | null {
  const failure = getThreadRunFailure(run);

  if (failure === null) {
    return null;
  }

  return (
    <div
      className="border-destructive/20 bg-destructive/[0.04] mt-4 flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-start"
      data-testid="thread-run-failure"
      role="alert"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <CircleX className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-destructive text-[12.5px] font-semibold">{failure.title}</div>
          <div className="text-fg-2 mt-0.5 text-[12.5px] leading-relaxed break-words">
            {failure.message}
          </div>
          {failure.code === null ? null : (
            <div className="text-fg-3 mt-1 font-mono text-[10.5px] break-all">{failure.code}</div>
          )}
        </div>
      </div>
      <Button size="xs" variant="outline" className="shrink-0 self-start" onClick={onOpenProcess}>
        View process
        <ChevronRight className="size-3" />
      </Button>
    </div>
  );
}
