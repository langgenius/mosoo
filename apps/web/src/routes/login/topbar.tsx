import { MOSOO_MARKETING_ORIGIN } from "@mosoo/contracts/origin";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { LocaleSwitcher } from "@/shared/i18n/locale-switcher";
import { ArrowLeft } from "@/shared/ui/icons";

function Brand(): ReactElement {
  return (
    <span aria-label="mosoo" className="inline-flex items-center">
      <img src="/brand/logo-wordmark-onlight.svg" alt="mosoo" className="block h-[22px]" />
    </span>
  );
}

export function LoginAuthTopbar(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center px-6 py-[22px] sm:px-10">
      <a
        href={MOSOO_MARKETING_ORIGIN}
        className="text-fg-2 hover:text-fg-1 flex items-center gap-1.5 text-[13px] font-semibold transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        {t("login.backToMosoo")}
      </a>
      <Brand />
      <div className="flex justify-end">
        <LocaleSwitcher compact />
      </div>
    </div>
  );
}
