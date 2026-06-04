import type { ReactElement } from "react";

export function EmptyFeedState(): ReactElement {
  return (
    <div className="flex min-h-full items-center justify-center px-8 py-16">
      <div className="max-w-sm text-center">
        <div className="text-fg-1 text-[14px] font-semibold">No events yet.</div>
        <p className="text-fg-3 mt-1 text-[12.5px] leading-5">
          The first user.message will appear here when the agent runs.
        </p>
      </div>
    </div>
  );
}
