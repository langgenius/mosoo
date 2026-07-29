import { MousePointerClick, SquareTerminal } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { writeClipboardText } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { CopyCheckIcon } from "@/shared/ui/copy-check-icon";

import { INSTALL_COMMAND } from "./onboarding-setup-prompt";
import { DocsAction, OnboardingActions, OnboardingSteps } from "./onboarding-steps";

type SetupLane = "cli" | "console";

const SETUP_LANE_STORAGE_KEY = "mosoo_overview_setup_lane";

function readStoredSetupLane(): SetupLane | null {
  try {
    const value = globalThis.localStorage.getItem(SETUP_LANE_STORAGE_KEY);
    return value === "cli" || value === "console" ? value : null;
  } catch {
    return null;
  }
}

function storeSetupLane(lane: SetupLane): void {
  try {
    globalThis.localStorage.setItem(SETUP_LANE_STORAGE_KEY, lane);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function SetupLaneTab({
  active,
  icon,
  label,
  onSelect,
}: {
  active: boolean;
  icon: ReactElement;
  label: string;
  onSelect: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors",
        active ? "bg-card text-fg-1 shadow-xs" : "text-fg-3 hover:text-fg-2",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function CodingAgentLane(): ReactElement {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copyInstallCommand(): Promise<void> {
    setCopyFailed(false);

    const didCopy = await writeClipboardText(INSTALL_COMMAND);

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
    <>
      <div className="border-border bg-bg-sunken mt-7 flex w-full flex-col items-stretch gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center">
        <code className="text-fg-1 min-w-0 flex-1 truncate text-left font-mono text-[13px] sm:text-base">
          <span className="text-fg-3 select-none">$ </span>
          {INSTALL_COMMAND}
        </code>
        <Button
          onClick={() => {
            void copyInstallCommand();
          }}
          className="w-full bg-[rgb(111_211_4)] text-black hover:bg-[rgb(111_211_4)] sm:w-auto"
          size="default"
          variant="accent"
        >
          <CopyCheckIcon copied={copied} />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {copyFailed ? (
        <div className="mt-2 w-full text-left">
          <input
            aria-label="mosoo install command"
            readOnly
            value={INSTALL_COMMAND}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className="border-border bg-bg-sunken text-fg-1 w-full rounded-md border px-3 py-2 font-mono text-xs"
          />
          <p className="text-fg-3 mt-1 text-xs">Copy failed. Select and copy the command above.</p>
        </div>
      ) : null}

      <p className="text-fg-3 mt-3 max-w-2xl text-[13px] leading-5">
        One command installs the mosoo CLI and the @mosoo skill, signs in to try.mosoo.ai, and
        checks cloud readiness. Sign-in creates your API token automatically; you will be asked for
        a provider key before sessions can run.
      </p>

      <OnboardingActions />
    </>
  );
}

function ConsoleLane(): ReactElement {
  return (
    <>
      <OnboardingSteps />
      <div className="mt-3 w-full">
        <DocsAction />
      </div>
    </>
  );
}

/**
 * The pre-deploy Overview hero, split into two explicit setup lanes: "In your
 * coding agent" (install command, auto-minted CLI token, copyable setup
 * prompt) and "In the console" (the three-step checklist). Both lanes read
 * the same account state, so progress counts once wherever a step happens.
 * The last chosen lane is remembered locally; first visits land on the
 * coding-agent lane.
 */
export function AppOverviewInstallGuide(): ReactElement {
  const [lane, setLane] = useState<SetupLane>(() => readStoredSetupLane() ?? "cli");

  function selectLane(nextLane: SetupLane): void {
    setLane(nextLane);
    storeSetupLane(nextLane);
  }

  return (
    <section className="py-8 sm:py-10">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <h2 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
          Build agent app with <span className="text-[rgb(111_211_4)]">mosoo</span>
        </h2>
        <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-7">
          Pick how you want to set up. Progress counts the same either way.
        </p>

        <div className="border-border bg-bg-sunken mt-7 inline-flex rounded-lg border p-1">
          <SetupLaneTab
            active={lane === "cli"}
            icon={<SquareTerminal className="size-4" />}
            label="In your coding agent"
            onSelect={() => {
              selectLane("cli");
            }}
          />
          <SetupLaneTab
            active={lane === "console"}
            icon={<MousePointerClick className="size-4" />}
            label="In the console"
            onSelect={() => {
              selectLane("console");
            }}
          />
        </div>

        {lane === "cli" ? <CodingAgentLane /> : <ConsoleLane />}
      </div>
    </section>
  );
}
