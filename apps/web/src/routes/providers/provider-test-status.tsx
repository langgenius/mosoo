import { Check, X } from "lucide-react";
import type { ReactElement } from "react";

import type { TestConnectionState } from "../../domains/vendor-credential/model/provider-credentials-model";

export function ProviderTestStatus({
  error,
  state,
}: {
  error: string | null;
  state: TestConnectionState;
}): ReactElement | null {
  if (state === "success") {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-green-700">
        <Check className="size-3.5 shrink-0" />
        Connection ok
      </span>
    );
  }

  if (state !== "failure") {
    return null;
  }

  return (
    <output
      aria-live="polite"
      className="text-destructive inline-flex max-w-[32rem] items-start gap-1 text-[12px] leading-snug break-words whitespace-normal"
    >
      <X className="mt-0.5 size-3.5 shrink-0" />
      {error ?? "Provider error"}
    </output>
  );
}
