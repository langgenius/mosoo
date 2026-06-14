import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  Copy,
  Folder,
  KeyRound,
  Plus,
  Rocket,
  Terminal,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { useSpacesQuery } from "@/domains/space/query/space-queries";
import { HELP_DOCS_BASE_URL } from "@/shared/config/help-docs";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { ListPageContent } from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";

const CLI_DOCS_URL = `${HELP_DOCS_BASE_URL}/cli/overview`;
const QUICKSTART_DOCS_URL = `${HELP_DOCS_BASE_URL}/quickstart`;

interface InstallStep {
  command?: string;
  description: ReactNode;
  icon: LucideIcon;
  title: string;
}

const INSTALL_STEPS: InstallStep[] = [
  {
    command: "npm install -g @mosoo/cli",
    description: "Install the Mosoo command-line interface to manage agents from your terminal.",
    icon: Terminal,
    title: "Install the CLI",
  },
  {
    command: "mosoo login --token <your-api-token>",
    description: (
      <>
        Create an API token in{" "}
        <Link className="text-fg-1 underline underline-offset-2" to="/settings/access-tokens">
          API tokens
        </Link>{" "}
        and authenticate the CLI with it.
      </>
    ),
    icon: KeyRound,
    title: "Authenticate",
  },
  {
    command: "mosoo agents run <agent>",
    description: "Launch an agent in an isolated sandbox and stream its output back to you.",
    icon: Rocket,
    title: "Run your first agent",
  },
];

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(value);
  } catch {
    // Clipboard copy is optimistic; a denied permission is non-blocking.
  }
}

function CommandBlock({ command }: { command: string }): ReactElement {
  const [copied, setCopied] = useState(false);

  return (
    <div className="bg-muted/50 border-border-subtle mt-2.5 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <code className="text-fg-1 min-w-0 flex-1 truncate font-mono text-[12.5px]">
        <span className="text-fg-3 select-none">$ </span>
        {command}
      </code>
      <Button
        aria-label="Copy command"
        onClick={() => {
          void copyText(command);
          setCopied(true);
          globalThis.setTimeout(() => {
            setCopied(false);
          }, 1500);
        }}
        size="icon-xs"
        variant="ghost"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

function InstallStepRow({ index, step }: { index: number; step: InstallStep }): ReactElement {
  const Icon = step.icon;

  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold">
          {index + 1}
        </span>
        {index < INSTALL_STEPS.length - 1 ? (
          <span aria-hidden="true" className="bg-border-soft mt-1 w-px flex-1" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <div className="flex items-center gap-2">
          <Icon className="text-fg-3 size-4" />
          <h3 className="text-fg-1 text-[14px] font-semibold">{step.title}</h3>
        </div>
        <p className="text-fg-2 mt-1 text-[13px] leading-5">{step.description}</p>
        {step.command ? <CommandBlock command={step.command} /> : null}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  loading,
  to,
  value,
}: {
  icon: LucideIcon;
  label: string;
  loading: boolean;
  to: string;
  value: number;
}): ReactElement {
  return (
    <Link
      to={to}
      className="border-border bg-card hover:border-border-strong group flex items-center gap-3.5 rounded-lg border p-4 transition-colors"
    >
      <div className="bg-muted/60 text-fg-2 flex size-10 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-fg-3 text-[11px] font-semibold tracking-[0.08em] uppercase">
          {label}
        </div>
        <div className="text-fg-1 mt-0.5 text-[20px] font-semibold tabular-nums">
          {loading ? "—" : value}
        </div>
      </div>
      <ArrowUpRight className="text-fg-3 group-hover:text-fg-1 size-4 shrink-0 transition-colors" />
    </Link>
  );
}

export function OverviewPage(): ReactElement {
  const { activeOrganization } = useAppSession();
  const organizationId = activeOrganization?.id ?? null;
  const agentsQuery = useVisibleAgentsQuery(organizationId);
  const spacesQuery = useSpacesQuery(organizationId);

  const agents = agentsQuery.data ?? [];
  const publishedCount = agents.filter((agent) => agent.status === "published").length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Overview"
        description="Install the Mosoo CLI, then configure, run, and ship agents from your terminal or the console."
      >
        <Button asChild size="sm" variant="outline">
          <a href={CLI_DOCS_URL} rel="noreferrer" target="_blank">
            <BookOpen className="size-3.5" />
            CLI docs
          </a>
        </Button>
        <Button asChild size="sm">
          <Link to="/agent?create=1">
            <Plus className="size-3.5" />
            New agent
          </Link>
        </Button>
      </PageHeader>

      <ListPageContent>
        <div className="mx-auto max-w-4xl space-y-6">
          <section className="border-border bg-card rounded-lg border p-5">
            <div className="mb-4">
              <h2 className="text-fg-1 text-[15px] font-semibold">Get started</h2>
              <p className="text-fg-2 mt-1 text-[13px] leading-5">
                Get your first agent running in a few minutes. Already set up?{" "}
                <a
                  className={cn("text-fg-1 underline underline-offset-2")}
                  href={QUICKSTART_DOCS_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  Read the quickstart
                </a>
                .
              </p>
            </div>
            <div>
              {INSTALL_STEPS.map((step, index) => (
                <InstallStepRow index={index} key={step.title} step={step} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-fg-1 mb-3 text-[15px] font-semibold">Your workspace</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                icon={Bot}
                label="Agents"
                loading={agentsQuery.isLoading}
                to="/agent"
                value={agents.length}
              />
              <StatCard
                icon={Rocket}
                label="Published"
                loading={agentsQuery.isLoading}
                to="/agent"
                value={publishedCount}
              />
              <StatCard
                icon={Folder}
                label="Spaces"
                loading={spacesQuery.isLoading}
                to="/space"
                value={spacesQuery.data?.length ?? 0}
              />
            </div>
          </section>
        </div>
      </ListPageContent>
    </div>
  );
}
