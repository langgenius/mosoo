import { ArrowLeft, MessageSquare } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { useAgentDetailQuery } from "@/domains/agent/query/agent-queries";
import { Button } from "@/shared/ui/button";

import { SlackChannelInlineSetup } from "./components/settings-dialog-slack-setup";

const SLACK_CHANNEL_SETUP_LAYOUT_CLASSES = {
  content: "mx-auto w-full max-w-3xl px-5 py-6 pb-10",
  page: "bg-background flex h-full min-h-0 flex-col",
  scroll: "min-h-0 flex-1 overflow-y-auto",
} as const;

export function AgentSlackChannelSetupPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const agentQuery = useAgentDetailQuery(agentId ?? null);
  const agent = agentQuery.data;

  return (
    <div className={SLACK_CHANNEL_SETUP_LAYOUT_CLASSES.page}>
      <header className="border-border-subtle flex h-13 items-center justify-between border-b bg-white px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            aria-label="Back to Agent"
            className="text-muted-foreground"
            onClick={() => {
              void navigate(agentId ? `/agent/${agentId}?settings=1` : "/agent");
            }}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="bg-muted flex size-7 items-center justify-center rounded-md">
            <MessageSquare className="text-muted-foreground size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-foreground truncate text-sm font-semibold">Slack</div>
            <div className="text-muted-foreground truncate text-[11px]">
              {agent?.name ?? "Loading Agent"}
            </div>
          </div>
        </div>
      </header>

      <main className={SLACK_CHANNEL_SETUP_LAYOUT_CLASSES.scroll}>
        <div className={SLACK_CHANNEL_SETUP_LAYOUT_CLASSES.content}>
          {agentQuery.isLoading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : agentQuery.error || !agent ? (
            <div className="text-destructive text-sm">
              {agentQuery.error instanceof Error ? agentQuery.error.message : "Agent not found."}
            </div>
          ) : (
            <SlackChannelInlineSetup
              agent={agent}
              onSuccess={() => {
                void navigate(`/agent/${agent.id}?settings=1`);
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
