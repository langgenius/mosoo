import { ArrowUpRight, Check, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { HELP_DOCS_HOME_URL } from "@/shared/config/help-docs";
import { useTranslation } from "@/shared/i18n";
import { writeClipboardText } from "@/shared/lib/clipboard";
import { Badge } from "@/shared/ui/badge";
import { RuntimeIcon } from "@/shared/ui/brand-icons";
import { CopyCheckIcon } from "@/shared/ui/copy-check-icon";

import { buildOnboardingSetupPrompt } from "./onboarding-setup-prompt";
import { useOnboardingProgress } from "./use-onboarding-progress";

const CODING_AGENT_HARNESSES = [
  { label: "Codex", runtimeId: "codex" },
  { label: "Claude Code", runtimeId: "claude-code" },
  { label: "OpenCode", runtimeId: "opencode" },
  { label: "Cursor", runtimeId: "cursor" },
  { label: "Cline", runtimeId: "cline" },
] as const;

interface OnboardingStepView {
  done: boolean;
  label: string;
  number: number;
  optional: boolean;
  to: string;
}

function StepMarker({ done, number }: { done: boolean; number: number }): ReactElement {
  const { t } = useTranslation();

  if (done) {
    return (
      <span className="text-on-accent flex size-6 shrink-0 items-center justify-center rounded-full bg-green-500">
        <Check className="size-3.5" strokeWidth={3} />
        <span className="sr-only">{t("common.done")}</span>
      </span>
    );
  }

  return (
    <span className="border-border-strong bg-bg-sunken text-fg-2 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
      {number}
    </span>
  );
}

function StepRow({ step }: { step: OnboardingStepView }): ReactElement {
  const { t } = useTranslation();

  return (
    <Link
      className="group hover:bg-paper-100 flex items-center gap-3 px-4 py-3.5 transition-colors"
      to={step.to}
    >
      <StepMarker done={step.done} number={step.number} />
      <span className="text-fg-1 min-w-0 flex-1 truncate text-left text-sm leading-6 font-medium sm:text-base">
        {step.label}
      </span>
      {step.optional ? <Badge variant="outline">{t("onboarding.optional")}</Badge> : null}
      <ChevronRight className="text-fg-3 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/**
 * The three-step onboarding checklist on the App Overview. Every step opens
 * the matching console page, and completion is read from account state, so
 * the same checkmarks light up whether a step was finished here in the
 * console or by the CLI (browser sign-in mints the CLI token, a coding agent
 * can do the rest). Step 3 retargets to composing a Thread once an agent
 * exists.
 */
export function OnboardingSteps(): ReactElement {
  const { activeAppId } = useAppSession();
  const { t } = useTranslation();
  const progress = useOnboardingProgress(activeAppId);

  const steps: OnboardingStepView[] = [
    {
      done: progress.hasProviderKey === true,
      label: t("onboarding.addProviderKey"),
      number: 1,
      optional: false,
      to: "/providers",
    },
    {
      done: progress.hasApiToken === true,
      label: t("onboarding.createApiToken"),
      number: 2,
      optional: true,
      to: "/settings/access-tokens",
    },
    {
      done: progress.hasAgent === true && progress.hasRunThread === true,
      label: t("onboarding.createAgent"),
      number: 3,
      optional: false,
      to: progress.hasAgent === true ? "/threads?compose=1" : "/agent?create=1",
    },
  ];

  return (
    <nav
      aria-label={t("onboarding.steps")}
      className="border-border bg-card divide-border mt-8 w-full divide-y overflow-hidden rounded-lg border text-left shadow-xs"
    >
      {steps.map((step) => (
        <StepRow key={step.number} step={step} />
      ))}
    </nav>
  );
}

/** Link row into the hosted docs, shared by both setup lanes. */
export function DocsAction(): ReactElement {
  const { t } = useTranslation();

  return (
    <a
      className="group border-border bg-card hover:bg-paper-100 flex w-full items-center gap-4 rounded-lg border px-4 py-3.5 text-left transition-colors"
      href={HELP_DOCS_HOME_URL}
      rel="noreferrer"
      target="_blank"
    >
      <div className="min-w-0 flex-1">
        <span className="text-fg-1 text-sm leading-6 font-semibold sm:text-base">
          {t("onboarding.readDocs")}
        </span>
        <p className="text-fg-3 mt-0.5 text-[13px] leading-5">
          {t("onboarding.quickstartDescription")}
        </p>
      </div>
      <ArrowUpRight className="text-fg-2 size-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </a>
  );
}

/**
 * The follow-up actions of the coding-agent lane: copy a setup prompt that
 * lets any coding agent finish mosoo setup, or read the docs.
 */
export function OnboardingActions(): ReactElement {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copySetupPrompt(): Promise<void> {
    setCopyFailed(false);

    const didCopy = await writeClipboardText(buildOnboardingSetupPrompt(undefined, t));

    if (!didCopy) {
      setCopyFailed(true);
      return;
    }

    setCopied(true);
    globalThis.setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  return (
    <div className="mt-3 flex w-full flex-col gap-3">
      <button
        className="group border-border bg-card hover:bg-paper-100 flex w-full items-center gap-4 rounded-lg border px-4 py-3.5 text-left transition-colors"
        onClick={() => {
          void copySetupPrompt();
        }}
        type="button"
      >
        <div className="min-w-0 flex-1">
          <span className="text-fg-1 text-sm leading-6 font-semibold sm:text-base">
            {copied ? t("onboarding.setupPromptCopied") : t("onboarding.setupWithAgent")}
          </span>
          <p className="text-fg-3 mt-0.5 text-[13px] leading-5">
            {t("onboarding.docsDescription")}
          </p>
        </div>
        <span
          aria-label={t("onboarding.harnesses")}
          className="hidden items-center gap-1.5 sm:flex"
        >
          {CODING_AGENT_HARNESSES.map((harness) => (
            <span
              className="border-border bg-bg-sunken inline-flex size-7 items-center justify-center rounded-md border"
              key={harness.runtimeId}
              title={harness.label}
            >
              <RuntimeIcon className="size-4.5" runtimeId={harness.runtimeId} />
              <span className="sr-only">{harness.label}</span>
            </span>
          ))}
        </span>
        <CopyCheckIcon className="text-fg-2 size-4 shrink-0" copied={copied} />
      </button>

      {copyFailed ? (
        <div className="w-full text-left">
          <textarea
            aria-label={t("appOverview.setupPromptLabel")}
            className="border-border bg-bg-sunken text-fg-1 h-28 w-full rounded-md border px-3 py-2 font-mono text-xs"
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            readOnly
            value={buildOnboardingSetupPrompt(undefined, t)}
          />
          <p className="text-fg-3 mt-1 text-xs">{t("appOverview.copyPromptFailed")}</p>
        </div>
      ) : null}

      <DocsAction />
    </div>
  );
}
