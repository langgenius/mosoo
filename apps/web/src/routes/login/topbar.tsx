import { ArrowLeft } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button";

import { GithubMarkLink } from "./github-mark";
import { MOSOO_API_REFERENCE_URL, MOSOO_GITHUB_URL, MOSOO_X_URL } from "./links";
import { XMark } from "./x-mark";

const ICON_LINK_CLASS =
  "text-fg-2 hover:bg-paper-200/70 hover:text-fg-1 focus-visible:ring-ring flex size-9 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2";

function Brand(): ReactElement {
  return (
    <span aria-label="Mosoo" className="inline-flex items-center">
      <img src="/brand/logo-wordmark-onlight.svg" alt="Mosoo" className="block h-[22px]" />
    </span>
  );
}

export function LoginLandingTopbar({ onContinue }: { onContinue: () => void }): ReactElement {
  return (
    <div className="border-border-soft/70 bg-paper-100/80 sticky top-0 z-50 border-b backdrop-blur-md">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-4 py-3 md:px-6">
        <Brand />
        <div className="flex items-center gap-1">
          <a
            href={MOSOO_API_REFERENCE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-fg-2 hover:text-fg-1 focus-visible:ring-ring hidden rounded-md px-3 text-[13.5px] font-semibold transition-colors outline-none focus-visible:ring-2 sm:inline-flex"
          >
            API reference
          </a>
          <a
            href={MOSOO_X_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Mosoo on X"
            title="Mosoo on X"
            className={ICON_LINK_CLASS}
          >
            <XMark className="size-4" />
          </a>
          <GithubMarkLink
            href={MOSOO_GITHUB_URL}
            className={ICON_LINK_CLASS}
            label="Mosoo on GitHub"
          />
          <Button variant="outline" className="ml-1" onClick={onContinue}>
            Log in
          </Button>
        </div>
      </div>
    </div>
  );
}

export function LoginAuthTopbar({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <div className="flex items-center justify-between px-10 py-[22px]">
      <button
        type="button"
        onClick={onBack}
        className="text-fg-2 hover:text-fg-1 flex items-center gap-1.5 text-[13px] font-semibold transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </button>
      <Brand />
      <div className="w-[60px]" />
    </div>
  );
}
