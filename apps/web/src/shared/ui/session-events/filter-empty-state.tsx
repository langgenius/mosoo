import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button";

export function FilterEmptyState({ onReset }: { onReset: () => void }): ReactElement {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-8 text-center">
      <div>
        <div className="text-fg-1 text-[14px] font-semibold">No events match these filters.</div>
        <p className="text-fg-3 mt-1 text-[12.5px]">Reset the feed to inspect the full turn.</p>
      </div>
      <Button onClick={onReset} size="sm" variant="outline">
        Reset filters
      </Button>
    </div>
  );
}
