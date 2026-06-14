import { ArrowRight, BookOpen, Check, Code, Copy, ExternalLink, Inbox, Plug } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/shared/ui/button";

import type { Agent } from "../agent.types";
import { buildAgentApiCurl, buildAgentDistribution } from "./distribution-info";

export interface DistributionPanelProps {
  agent: Agent;
  onManageCooperators?: () => void;
  onOpenSettings?: () => void;
}

interface DistributionCardProps {
  children: ReactNode;
  icon: ReactNode;
  subtitle?: ReactNode;
  title: string;
}

async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Clipboard feedback is optimistic; failed copies are non-blocking.
  }
}

// Distribution dashboard for Stage 3 of the lifecycle.
// Cooperator management, token issuance, and API docs remain in their owner surfaces.
export function DistributionPanel({
  agent,
  onManageCooperators,
  onOpenSettings,
}: DistributionPanelProps): ReactElement {
  const distribution = useMemo(() => buildAgentDistribution(agent), [agent]);
  const curlExample = useMemo(() => buildAgentApiCurl(agent), [agent]);
  const [copiedKey, setCopiedKey] = useState<"api" | "curl" | null>(null);
  const isLive = agent.status === "published";

  function copy(text: string, key: "api" | "curl") {
    void writeClipboardText(text);
    setCopiedKey(key);
    globalThis.setTimeout(() => {
      setCopiedKey(null);
    }, 1500);
  }

  return (
    <div className="mx-auto h-full w-full max-w-[760px] overflow-y-auto p-6">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-foreground text-[18px] font-semibold">Distribution</h2>
          <p className="text-fg-3 mt-1 text-[12.5px]">
            How allowed callers reach this agent. Visibility is{" "}
            <span className="text-foreground font-medium">
              {isLive ? "live" : "draft (publish to enable)"}
            </span>
            . Personal-token authenticated, access-gated, and executed as the App owner's Agent.
          </p>
        </div>
        {onOpenSettings ? (
          <Button onClick={onOpenSettings} size="sm" variant="outline">
            Settings
          </Button>
        ) : null}
      </div>

      <section className="space-y-3">
        <DistributionCard icon={<Inbox className="text-fg-3 size-4" />} title="Threads">
          <Button
            asChild
            className="gap-1 text-[11.5px]"
            disabled={!isLive}
            size="xs"
            variant="outline"
          >
            <a href={isLive ? distribution.threadsUrl : "#"}>
              Start a thread
              <ArrowRight className="size-3" />
            </a>
          </Button>
        </DistributionCard>

        <DistributionCard
          icon={<Code className="text-fg-3 size-4" />}
          title="API access"
          subtitle={
            <>
              <div className="text-fg-2 font-mono text-[12px]">{distribution.apiPath}</div>
              <div className="text-fg-3 mt-0.5 text-[11px]">
                Use an API token from{" "}
                <a
                  className="decoration-fg-3/50 hover:text-foreground underline underline-offset-2"
                  href={distribution.tokenSettingsPath}
                >
                  settings / API Tokens
                </a>{" "}
                · 403 outside Agent access · 429 includes Retry-After
              </div>
            </>
          }
        >
          <Button asChild className="gap-1 text-[11.5px]" size="xs" variant="outline">
            <a href={distribution.apiDocsUrl} rel="noreferrer" target="_blank">
              <BookOpen className="size-3" />
              Docs
            </a>
          </Button>
          <Button
            className="gap-1 text-[11.5px]"
            disabled={!isLive}
            onClick={() => {
              copy(distribution.apiPath, "api");
            }}
            size="xs"
            variant="outline"
          >
            {copiedKey === "api" ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copiedKey === "api" ? "Copied" : "Copy path"}
          </Button>
          <Button asChild className="gap-1 text-[11.5px]" size="xs" variant="outline">
            <a href={distribution.openApiUrl} rel="noreferrer" target="_blank">
              <ExternalLink className="size-3" />
              OpenAPI
            </a>
          </Button>
        </DistributionCard>

        {isLive ? (
          <div className="border-border-subtle bg-bg-1 rounded-lg border px-3.5 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-fg-3 text-[11.5px] font-medium tracking-wide uppercase">
                curl example
              </span>
              <Button
                className="gap-1 text-[11.5px]"
                onClick={() => {
                  copy(curlExample, "curl");
                }}
                size="xs"
                variant="ghost"
              >
                {copiedKey === "curl" ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copiedKey === "curl" ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="text-foreground overflow-x-auto rounded-md bg-white px-3 py-2.5 text-[11.5px] leading-relaxed whitespace-pre">
              {curlExample}
            </pre>
            <p className="text-fg-3 mt-2 text-[11.5px] leading-relaxed">
              Add <span className="text-fg-2 font-mono">Idempotency-Key</span> when retrying
              create-thread calls. Follow-up messages, confirmations, archive, and delete stay on
              the Thread API.
            </p>
          </div>
        ) : null}

        <DistributionCard
          icon={<Plug className="text-fg-3 size-4" />}
          title="Channels"
          subtitle={
            <span className="text-fg-3 text-[12px]">
              Slack / Lark / Discord integrations · coming after publish-flow GA
            </span>
          }
        >
          <Button disabled className="text-[11.5px]" size="xs" variant="outline">
            Coming soon
          </Button>
        </DistributionCard>

        <div className="border-border-subtle bg-card rounded-lg border px-3.5 py-3">
          <div className="text-foreground text-[13px] font-medium">Cooperators</div>
          <p className="text-fg-3 mt-0.5 text-[12px] leading-relaxed">
            Cooperators are the explicit allow-list for API token callers.
          </p>
          <div className="mt-2.5">
            <Button
              disabled={!onManageCooperators}
              onClick={onManageCooperators}
              size="xs"
              variant="outline"
            >
              Manage cooperators
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function DistributionCard({
  children,
  icon,
  subtitle,
  title,
}: DistributionCardProps): ReactElement {
  return (
    <div className="border-border-subtle bg-card rounded-lg border px-3.5 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-foreground text-[13px] font-medium">{title}</div>
          {subtitle === undefined ? null : <div className="mt-0.5 truncate">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 gap-1">{children}</div>
      </div>
    </div>
  );
}
