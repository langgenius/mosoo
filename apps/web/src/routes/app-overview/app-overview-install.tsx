import { Check, KeyRound } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { writeClipboardText } from "@/shared/lib/clipboard";
import { RuntimeIcon } from "@/shared/ui/brand-icons";
import { Button } from "@/shared/ui/button";
import { CopyIconFeedback } from "@/shared/ui/copy-icon-feedback";

const INSTALL_COMMAND = "curl -fsSL https://install.mosoo.ai/install.sh | bash";
const API_TOKENS_PATH = "/settings/access-tokens";
const READY_STEPS = [
  "Installs Mosoo CLI",
  "Installs the @mosoo skill",
  "Signs in to cloud and runs doctor",
] as const;
const CODING_AGENT_HARNESSES = [
  { label: "Codex", runtimeId: "codex" },
  { label: "Claude Code", runtimeId: "claude-code" },
  { label: "OpenCode", runtimeId: "opencode" },
  { label: "Cursor", runtimeId: "cursor" },
  { label: "Cline", runtimeId: "cline" },
] as const;

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
          Build agent app with <span className="text-[rgb(111_211_4)]">Mosoo</span> in your coding
          agent
        </h2>
        <p className="text-muted-foreground mt-3 max-w-2xl text-base leading-7">
          One command installs Mosoo CLI and the @mosoo skill, signs in to try.mosoo.ai, and checks
          cloud readiness.
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
            className="w-full bg-[rgb(111_211_4)] text-black hover:bg-[rgb(111_211_4)] sm:w-auto"
            size="default"
            variant="accent"
          >
            <CopyIconFeedback copied={copied} />
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
            <p className="text-fg-3 mt-1 text-xs">
              Copy failed. Select and copy the command above.
            </p>
          </div>
        ) : null}

        <div className="text-fg-2 mt-7 grid w-full max-w-3xl grid-cols-1 gap-3 text-sm leading-6 font-medium sm:grid-cols-3 sm:gap-4 sm:text-base">
          {READY_STEPS.map((label) => (
            <span className="inline-flex min-w-0 items-center justify-center gap-2" key={label}>
              <Check className="size-4 shrink-0 text-green-600" />
              {label}
            </span>
          ))}
        </div>

        <Button asChild className="mt-6" size="default" variant="outline">
          <Link to={API_TOKENS_PATH}>
            <KeyRound className="size-4" />
            Create API token
          </Link>
        </Button>

        <div
          aria-label="Supported coding agent harnesses"
          className="mt-8 flex w-full max-w-2xl flex-wrap items-center justify-center gap-3"
        >
          {CODING_AGENT_HARNESSES.map((harness) => (
            <span
              className="border-border bg-card inline-flex size-12 items-center justify-center rounded-md border shadow-xs"
              key={harness.runtimeId}
              title={harness.label}
            >
              <RuntimeIcon className="size-7" runtimeId={harness.runtimeId} />
              <span className="sr-only">{harness.label}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
