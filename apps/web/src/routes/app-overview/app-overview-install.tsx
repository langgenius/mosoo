import { useMutation } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Download } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import { createPersonalAccessToken } from "@/domains/auth/api/personal-access-token-client";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

// The on-screen token stays masked; the real value only ever lands on the
// clipboard so it is not rendered into the DOM.
const MASKED_TOKEN = "mst_••••••••••••";
const OTHER_AGENTS = ["Codex", "Cursor", "Cline"] as const;
const READY_STEPS = ["Installs the @mosoo skill", "Signs the CLI in", "Ready to deploy"] as const;

// A copyable, downloadable skill so any coding agent (Codex / Cursor / Cline …)
// can drive Mosoo without the bundled `npx mosoo` wrapper.
const MOSOO_SKILL_MARKDOWN = `---
name: mosoo
description: Deploy and run agents on your Mosoo App from any coding agent.
---

# mosoo

Hand work to your Mosoo App from any coding agent.

## Log in

\`\`\`bash
npx mosoo login --token <your mst_ token>
\`\`\`

## Deploy

\`\`\`bash
npx mosoo deploy
\`\`\`

## Run an agent

\`\`\`bash
npx mosoo run <agent> --prompt "ship the release notes"
\`\`\`
`;

function buildLoginCommand(token: string): string {
  return `npx mosoo login --token ${token}`;
}

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

function downloadTextFile(filename: string, contents: string): void {
  if (typeof document === "undefined") {
    return;
  }

  const blob = new Blob([contents], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AppOverviewInstallGuide(): ReactElement {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [skillCopied, setSkillCopied] = useState(false);
  // Default to expanded so the @mosoo skill + Copy/Download actions are visible
  // without an extra click for users on Codex / Cursor / Cline.
  const [showOtherAgents, setShowOtherAgents] = useState(true);

  const createTokenMutation = useMutation({
    mutationFn: async () => createPersonalAccessToken("mosoo CLI"),
    onSuccess: (response) => {
      setToken(response.value);
    },
  });

  async function copyLoginCommand(): Promise<void> {
    setCopyFailed(false);

    try {
      // Mint one real CLI token on first copy, then reuse it for the session.
      const value = token ?? (await createTokenMutation.mutateAsync()).value;
      const didCopy = await writeClipboardText(buildLoginCommand(value));

      if (!didCopy) {
        setCopyFailed(true);
        return;
      }

      setCopied(true);
      globalThis.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopyFailed(true);
    }
  }

  async function copySkill(): Promise<void> {
    const didCopy = await writeClipboardText(MOSOO_SKILL_MARKDOWN);

    if (!didCopy) {
      return;
    }

    setSkillCopied(true);
    globalThis.setTimeout(() => {
      setSkillCopied(false);
    }, 1500);
  }

  const minting = createTokenMutation.isPending;

  return (
    <section className="py-6">
      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <h2 className="text-foreground text-2xl font-semibold tracking-tight">
          Hand Mosoo to your agent
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          One command installs the @mosoo skill, signs the CLI in, and your coding agent is ready to
          deploy.
        </p>

        <div className="border-border bg-bg-sunken mt-6 flex w-full items-center gap-3 rounded-lg border px-4 py-2.5">
          <code className="text-fg-1 min-w-0 flex-1 truncate text-left font-mono text-sm">
            <span className="text-fg-3 select-none">$ </span>
            npx mosoo login --token {MASKED_TOKEN}
          </code>
          <Button
            disabled={minting}
            onClick={() => {
              void copyLoginCommand();
            }}
            size="sm"
            variant="accent"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : minting ? "Generating…" : "Copy command"}
          </Button>
        </div>

        {copyFailed && token !== null ? (
          <div className="mt-2 w-full text-left">
            <input
              aria-label="mosoo login command"
              readOnly
              value={buildLoginCommand(token)}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              className="border-border bg-bg-sunken text-fg-1 w-full rounded-md border px-3 py-2 font-mono text-xs"
            />
            <p className="text-fg-3 mt-1 text-xs">
              Copy failed — select and copy the command above.
            </p>
          </div>
        ) : null}

        <div className="text-fg-2 mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium">
          {READY_STEPS.map((label) => (
            <span className="inline-flex items-center gap-1.5" key={label}>
              <Check className="size-3.5 text-green-600" />
              {label}
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            setShowOtherAgents((open) => !open);
          }}
          className="text-fg-3 hover:text-fg-1 mt-6 inline-flex items-center gap-1 text-xs transition-colors"
        >
          Using another agent? {OTHER_AGENTS.join(" · ")}
          <ChevronDown
            className={cn("size-3.5 transition-transform", showOtherAgents && "rotate-180")}
          />
        </button>

        {showOtherAgents ? (
          <div className="border-border bg-bg-sunken mt-3 w-full rounded-lg border p-4 text-left">
            <p className="text-muted-foreground text-xs">
              Copy or download the @mosoo skill for Codex, Cursor, Cline, or any coding agent.
            </p>
            <pre className="text-fg-2 bg-card/60 mt-3 max-h-48 overflow-auto rounded-md p-3 font-mono text-[11px] leading-relaxed">
              {MOSOO_SKILL_MARKDOWN}
            </pre>
            <div className="mt-3 flex items-center gap-2">
              <Button
                onClick={() => {
                  void copySkill();
                }}
                size="sm"
                variant="outline"
              >
                {skillCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {skillCopied ? "Copied" : "Copy skill"}
              </Button>
              <Button
                onClick={() => {
                  downloadTextFile("SKILL.md", MOSOO_SKILL_MARKDOWN);
                }}
                size="sm"
                variant="ghost"
              >
                <Download className="size-3.5" />
                Download SKILL.md
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
