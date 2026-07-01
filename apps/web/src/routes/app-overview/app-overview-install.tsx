import { Check, Copy } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { Button } from "@/shared/ui/button";

const INSTALL_COMMAND = "curl -fsSL https://install.mosoo.ai/install.sh | bash";
const READY_STEPS = [
  "Installs or updates Mosoo CLI",
  "Updates the Codex @mosoo skill",
  "Signs in to cloud and runs doctor",
] as const;

async function writeClipboardText(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function AppOverviewInstallGuide(): ReactElement {
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
    <section className="py-8 sm:py-10">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <h2 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
          Hand Mosoo to your agent
        </h2>
        <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-7">
          One command installs Mosoo CLI, refreshes the Codex skill, signs in to try.mosoo.ai, and
          checks cloud readiness.
        </p>

        <div className="border-border bg-bg-sunken mt-8 flex w-full flex-col items-stretch gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center">
          <code className="text-fg-1 min-w-0 flex-1 truncate text-left font-mono text-[13px] sm:text-base">
            <span className="text-fg-3 select-none">$ </span>
            {INSTALL_COMMAND}
          </code>
          <Button
            onClick={() => {
              void copyInstallCommand();
            }}
            className="w-full sm:w-auto"
            size="default"
            variant="accent"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy command"}
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
            <p className="text-fg-3 mt-1 text-xs">
              Copy failed. Select and copy the command above.
            </p>
          </div>
        ) : null}

        <div className="text-fg-2 mt-7 grid w-full max-w-2xl grid-cols-1 gap-2 text-xs font-medium sm:grid-cols-3">
          {READY_STEPS.map((label) => (
            <span className="inline-flex items-center justify-center gap-1.5" key={label}>
              <Check className="size-3.5 text-green-600" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
