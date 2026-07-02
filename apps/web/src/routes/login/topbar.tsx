import { MOSOO_MARKETING_ORIGIN } from "@mosoo/contracts/origin";
import { ArrowLeft } from "lucide-react";
import type { ReactElement } from "react";

function Brand(): ReactElement {
  return (
    <span aria-label="Mosoo" className="inline-flex items-center">
      <img src="/brand/logo-wordmark-onlight.svg" alt="Mosoo" className="block h-[22px]" />
    </span>
  );
}

export function LoginAuthTopbar(): ReactElement {
  return (
    <div className="flex items-center justify-between px-10 py-[22px]">
      <a
        href={MOSOO_MARKETING_ORIGIN}
        className="text-fg-2 hover:text-fg-1 flex items-center gap-1.5 text-[13px] font-semibold transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Back to Mosoo
      </a>
      <Brand />
      <div className="w-[100px]" />
    </div>
  );
}
