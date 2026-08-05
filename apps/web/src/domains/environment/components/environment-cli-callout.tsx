import { Terminal } from "lucide-react";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { CommandBlock } from "@/shared/ui/command-block";

export const ENVIRONMENT_CLI_CREATE_COMMAND = "mosoo console environments create-environment";

// Always-visible callout steering users to the fastest Environment creation
// path: the mosoo CLI reads dependency files already in their project, so
// they never have to fill the form field by field.
export function EnvironmentCliCallout({ className }: { className?: string }): ReactElement {
  const { t } = useTranslation();

  return (
    <div className={cn("border-brand/25 bg-brand-light rounded-lg border px-4 py-3.5", className)}>
      <div className="flex items-center gap-2">
        <Terminal className="text-brand size-4 shrink-0" />
        <h3 className="text-fg-1 text-[13px] font-semibold">{t("environments.cliCalloutTitle")}</h3>
      </div>
      <p className="text-fg-2 mt-1.5 text-[12.5px] leading-relaxed">
        {t("environments.cliCalloutDescription")}
      </p>
      <CommandBlock className="mt-2.5 bg-white" command={ENVIRONMENT_CLI_CREATE_COMMAND} />
    </div>
  );
}
