import { Check } from "lucide-react";
import type { ReactElement } from "react";

type TestConnectionState = "failure" | "idle" | "running" | "success";

// Only the success state renders inline next to the Test button. Failures are
// surfaced by the form-level alert above the footer, so showing them here too
// would duplicate the same message between the Test and Save buttons.
export function ProviderTestStatus({ state }: { state: TestConnectionState }): ReactElement | null {
  if (state !== "success") {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-green-700">
      <Check className="size-3.5 shrink-0" />
      Connection ok
    </span>
  );
}
