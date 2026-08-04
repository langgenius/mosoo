import { MOSOO_MARKETING_ORIGIN } from "@mosoo/contracts/origin";
import { ArrowLeft } from "lucide-react";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { LocaleSwitcher } from "@/shared/i18n/locale-switcher";

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
    <div className="flex items-center justify-between px-10 py-[22px]">
      <a
        href={MOSOO_MARKETING_ORIGIN}
        className="text-fg-2 hover:text-fg-1 flex items-center gap-1.5 text-[13px] font-semibold transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        {t("login.backToMosoo")}
      </a>
      <Brand />
      <LocaleSwitcher />
    </div>
  );
}
