import { BookOpen, Check, Code, Copy, KeyRound } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";
import { writeClipboardText } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

import type { Agent } from "../agent.types";
import { buildAgentDistribution } from "./distribution-info";

type ApiAccessClipboardKey = "agent" | "docs";

interface AgentApiAccessDialogProps {
  agent: Agent;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

interface AgentApiAccessPanelProps {
  agent: Agent;
  showTitle?: boolean;
}

interface ApiAccessDetailRowProps {
  action: ReactNode;
  label: string;
  value: string;
}

export function AgentApiAccessDialog({
  agent,
  onOpenChange,
  open,
}: AgentApiAccessDialogProps): ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="rounded-lg p-0 sm:max-w-[520px]">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle className="text-[16px]">{t("agentLifecycle.apiAccess")}</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-5">
          <AgentApiAccessPanel agent={agent} showTitle={false} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AgentApiAccessPanel({
  agent,
  showTitle = true,
}: AgentApiAccessPanelProps): ReactElement {
  const { t } = useTranslation();
  const distribution = useMemo(() => buildAgentDistribution(agent), [agent]);
  const [copiedKey, setCopiedKey] = useState<ApiAccessClipboardKey | null>(null);

  async function copy(text: string, key: ApiAccessClipboardKey) {
    const didCopy = await writeClipboardText(text);
    if (!didCopy) {
      return;
    }

    setCopiedKey(key);
    globalThis.setTimeout(() => {
      setCopiedKey(null);
    }, 1500);
  }

  return (
    <div className="border-border-subtle bg-card w-full overflow-hidden rounded-lg border">
      {showTitle ? (
        <div className="border-border-subtle flex items-center gap-2 border-b px-3.5 py-2.5">
          <Code className="text-fg-3 size-4 shrink-0" />
          <div className="text-foreground text-[13px] font-medium">
            {t("agentLifecycle.apiAccess")}
          </div>
        </div>
      ) : null}

      <div className="space-y-2 p-3">
        <ApiAccessDetailRow
          action={
            <Button
              className="gap-1 text-[11.5px]"
              onClick={() => {
                void copy(agent.id, "agent");
              }}
              size="xs"
              variant="outline"
            >
              {copiedKey === "agent" ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copiedKey === "agent" ? t("common.copied") : t("common.copy")}
            </Button>
          }
          label={t("agent.agentId")}
          value={agent.id}
        />
        <ApiAccessDetailRow
          action={
            <Button asChild className="gap-1 text-[11.5px]" size="xs" variant="outline">
              <Link to={distribution.tokenSettingsPath}>
                <KeyRound className="size-3" />
                {t("agentLifecycle.createToken")}
              </Link>
            </Button>
          }
          label={t("agent.apiToken")}
          value={t("agentLifecycle.apiTokenSettingsLocation")}
        />
        <ApiAccessDetailRow
          action={
            <div className="flex flex-wrap gap-1">
              <Button
                className="gap-1 text-[11.5px]"
                onClick={() => {
                  void copy(distribution.apiDocsUrl, "docs");
                }}
                size="xs"
                variant="outline"
              >
                {copiedKey === "docs" ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copiedKey === "docs" ? t("common.copied") : t("common.copy")}
              </Button>
              <Button asChild className="gap-1 text-[11.5px]" size="xs" variant="outline">
                <a href={distribution.apiDocsUrl} rel="noreferrer" target="_blank">
                  <BookOpen className="size-3" />
                  {t("common.open")}
                </a>
              </Button>
            </div>
          }
          label={t("agent.apiReference")}
          value={distribution.apiDocsUrl}
        />
      </div>
    </div>
  );
}

function ApiAccessDetailRow({ action, label, value }: ApiAccessDetailRowProps): ReactElement {
  return (
    <div className="border-border-subtle bg-bg-1 rounded-md border px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-fg-3 text-[10.5px] font-medium tracking-wide uppercase">{label}</div>
          <div className="text-fg-2 mt-0.5 font-mono text-[12px] leading-snug break-all">
            {value}
          </div>
        </div>
        <div className="flex shrink-0">{action}</div>
      </div>
    </div>
  );
}
