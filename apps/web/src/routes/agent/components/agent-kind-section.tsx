import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createAgentFork } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId, toAppId } from "@/routes/typed-id";

import type { Agent, AgentKind } from "../agent.types";
import { KindForkDialog } from "../lifecycle/kind-fork-dialog";
import { KindLockBanner } from "./kind-lock-banner";
import { KindSelector } from "./kind-selector";

// Encapsulates the Agent Type selector, comparison panel, lock banner, and Fork
// dialog. Mounted at the top of the Preview configuration panel.
// Lock state starts at first publish and stays locked after unpublish because
// the live version snapshot remains attached to the original agent.
export function AgentKindSection({
  agent,
  onKindChange,
}: {
  agent: Agent;
  onKindChange?: ((kind: AgentKind) => void) | undefined;
}): ReactElement {
  const locked = agent.status === "published" || agent.liveVersion !== null;
  const canFork = agent.role === "owner";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const forkMutation = useMutation({
    mutationFn: createAgentFork,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
  const [forkDialog, setForkDialog] = useState<{ target: AgentKind } | null>(null);

  const handleKindChange = useCallback(
    (next: AgentKind) => {
      onKindChange?.(next);
    },
    [onKindChange],
  );

  const handleLockedCardClick = useCallback(
    (target: AgentKind) => {
      if (!canFork) {
        return;
      }
      setForkDialog({ target });
    },
    [canFork],
  );

  const handleClickFork = useCallback(() => {
    setForkDialog({ target: agent.kind === "pet" ? "cattle" : "pet" });
  }, [agent.kind]);

  const handleForkCancel = useCallback(() => setForkDialog(null), []);
  const handleForkConfirm = useCallback(async () => {
    if (forkDialog === null) {
      return;
    }

    const result = await forkMutation.mutateAsync({
      agentId: toAgentId(agent.id),
      kind: forkDialog.target,
      appId: toAppId(agent.appId),
    });

    setForkDialog(null);
    void navigate(
      globalThis.location.pathname.startsWith("/demo")
        ? `/demo/agent/${result.agent.id}`
        : `/agent/${result.agent.id}`,
    );
  }, [agent.id, forkDialog, forkMutation, navigate]);

  return (
    <>
      <KindSelector
        value={agent.kind}
        locked={locked}
        onChange={handleKindChange}
        onLockedCardClick={handleLockedCardClick}
      />
      {locked ? <KindLockBanner canFork={canFork} onClickFork={handleClickFork} /> : null}
      {forkDialog ? (
        <KindForkDialog
          agentName={agent.name}
          currentKind={agent.kind}
          targetKind={forkDialog.target}
          open
          busy={forkMutation.isPending}
          onCancel={handleForkCancel}
          onConfirm={() => void handleForkConfirm()}
        />
      ) : null}
    </>
  );
}
