import { Lock } from "lucide-react";

import { Button } from "@/shared/ui/button";

export function KindLockBanner({
  onClickFork,
  canFork,
}: {
  onClickFork: () => void;
  canFork: boolean;
}) {
  return (
    <div className="border-amber/30 bg-amber-bg flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5">
      <Lock className="text-amber-fg mt-0.5 size-3.5 shrink-0" />
      <div className="text-amber-fg flex-1 text-[12px] leading-relaxed">
        Agent type is locked for this published agent. Fork to switch type; sessions, cost, logs,
        and agent-state stay attached here.
      </div>
      {canFork ? (
        <Button onClick={onClickFork} size="xs" variant="outline" className="shrink-0">
          Fork agent
        </Button>
      ) : (
        <span className="text-amber-fg shrink-0 text-[11px]">Contact owner to fork</span>
      )}
    </div>
  );
}
