import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { Check } from "@/shared/ui/icons";

type TestConnectionState = "failure" | "idle" | "running" | "success";

// Only the success state renders inline next to the Test button. Failures are
// surfaced by the form-level alert above the footer, so showing them here too
// would duplicate the same message between the Test and Save buttons.
export function ProviderTestStatus({ state }: { state: TestConnectionState }): ReactElement | null {
  const { t } = useTranslation();

  if (state !== "success") {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-green-700">
      <Check className="size-3.5 shrink-0" />
      {t("providers.connectionOk")}
    </span>
  );
}
