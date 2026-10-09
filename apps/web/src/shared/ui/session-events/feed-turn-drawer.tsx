import { useMemo, useState } from "react";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { CopyCheckIcon } from "@/shared/ui/copy-check-icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { isSessionEventVisibleInMainFeed } from "./domain";
import { SessionEventDrawerCore } from "./drawer-core";
import { createSessionEventCopyText, turnStatusClassName, turnStatusLabel } from "./feed-display";
import { formatTokens, formatTotalDuration } from "./format";
import { calculateSessionTurnTokens } from "./turns";
import type { SessionTurn } from "./turns";

export function SessionTurnDrawer({
  focusEventId,
  onOpenChange,
  open,
  turn,
}: {
  focusEventId: string | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  turn: SessionTurn | null;
}): ReactElement {
  const { t } = useTranslation();
  const events = useMemo(() => turn?.events ?? [], [turn?.events]);
  const visibleEvents = useMemo(() => events.filter(isSessionEventVisibleInMainFeed), [events]);
  const title =
    turn === null
      ? t("sessionEvents.turnTitle")
      : t("sessionEvents.turn", { number: String(turn.index) });
  const [copied, setCopied] = useState(false);
  const totalDurationMs = visibleEvents.reduce(
    (total, event) => total + (event.durationMs ?? 0),
    0,
  );
  const totalTokens = calculateSessionTurnTokens(events);

  async function copyEvents(): Promise<void> {
    await navigator.clipboard.writeText(
      createSessionEventCopyText({ events: visibleEvents, title }, t),
    );
    setCopied(true);
    globalThis.setTimeout(() => {
      setCopied(false);
    }, 1400);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] !w-[calc(100vw-2rem)] !max-w-[1080px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border-soft shrink-0 border-b px-7 pt-4 pb-3">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-fg-1 text-[14px] font-semibold">{title}</DialogTitle>
                {turn !== null ? (
                  <span
                    className={cn(
                      "rounded-sm border px-1 py-0.5 text-[10.5px] font-semibold",
                      turnStatusClassName(turn.status),
                    )}
                  >
                    {turnStatusLabel(turn.status, t)}
                  </span>
                ) : null}
              </div>
              <DialogDescription className="text-fg-3 mt-0.5 text-[11.5px] tabular-nums">
                {formatTotalDuration(totalDurationMs)} · {visibleEvents.length}{" "}
                {t("sessionEvents.events")} · {formatTokens(totalTokens)}{" "}
                {t("sessionEvents.tokens")}
              </DialogDescription>
            </div>
            <Button
              onClick={() => {
                void copyEvents();
              }}
              size="sm"
              variant="outline"
            >
              <CopyCheckIcon copied={copied} />
              {copied ? t("common.copied") : t("common.copy")}
            </Button>
          </div>
        </DialogHeader>

        <SessionEventDrawerCore
          key={`${open}:${turn?.id ?? "none"}`}
          emptyState={
            <div className="px-7 py-12 text-center">
              <div className="text-fg-1 text-sm font-semibold">
                {t("sessionEvents.noEventsRecorded")}
              </div>
              <div className="text-fg-3 mt-1 text-[12.5px]">
                {t("sessionEvents.noDurableEvents")}
              </div>
            </div>
          }
          events={visibleEvents}
          focusEventId={focusEventId}
        />
      </DialogContent>
    </Dialog>
  );
}
