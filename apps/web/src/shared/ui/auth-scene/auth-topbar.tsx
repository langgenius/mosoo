import { MOSOO_MARKETING_ORIGIN } from "@mosoo/contracts/origin";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { LocaleSwitcher } from "@/shared/i18n/locale-switcher";
import { ArrowLeft } from "@/shared/ui/icons";

// "default" is the web sign-in (wordmark only); "computer" is the CLI/device
// sign-in, which tags the wordmark with "computer" so the two auth surfaces
// stay distinguishable at a glance.
export type AuthBrandVariant = "default" | "computer";

function Brand({ variant }: { variant: AuthBrandVariant }): ReactElement {
  const isComputer = variant === "computer";
  return (
    <span
      aria-label={isComputer ? "mosoo computer" : "mosoo"}
      className="inline-flex items-baseline gap-1.5"
    >
      <img src="/brand/logo-wordmark-onlight.svg" alt="" className="block h-[22px]" />
      {isComputer ? (
        <span className="text-fg-2 text-[15px] font-semibold tracking-[-0.01em]">computer</span>
      ) : null}
    </span>
  );
}

export function AuthTopbar({
  brand = "default",
}: {
  brand?: AuthBrandVariant;
}): ReactElement {
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
      <Brand variant={brand} />
      <div className="flex justify-end">
        <LocaleSwitcher compact />
      </div>
    </div>
  );
}
