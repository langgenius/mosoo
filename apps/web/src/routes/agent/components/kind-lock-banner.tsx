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
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-300/70 bg-amber-50 px-3.5 py-2.5">
      <Lock className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
      <div className="flex-1 text-[12px] leading-relaxed text-amber-950">
        Agent type is locked for this published agent. Fork to switch type; sessions, audit, cost,
        logs, and agent-state stay attached here.
      </div>
      {canFork ? (
        <Button onClick={onClickFork} size="xs" variant="outline" className="shrink-0">
          Fork agent
        </Button>
      ) : (
        <span className="shrink-0 text-[11px] text-amber-800">Contact owner to fork</span>
      )}
    </div>
  );
}
