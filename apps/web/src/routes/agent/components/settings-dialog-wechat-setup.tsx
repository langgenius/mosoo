import type { AgentId, AppId } from "@mosoo/contracts/id";
import { useMutation } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

import {
  pollWeChatAgentChannelPairing,
  startWeChatAgentChannelPairing,
} from "@/domains/agent/api/agent-client";
import { useInvalidateAgentChannelBindings } from "@/domains/agent/query/agent-queries";
import type {
  PollWeChatAgentChannelPairingInput,
  WeChatAgentChannelPairingFieldsFragment,
} from "@/gql/graphql";
import { toAgentId, toAppId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";

import type { ChannelInlineSetupAgent } from "./settings-dialog-channel-agent";

const WECHAT_POLL_INTERVAL_MS = 3_000;

type WeChatPairingStatus = WeChatAgentChannelPairingFieldsFragment["status"];

interface WeChatPairingStatusCopy {
  detail: string;
  label: string;
}

function getWeChatPairingStatusCopy(status: WeChatPairingStatus | null): WeChatPairingStatusCopy {
  switch (status) {
    case "confirmed":
      return {
        detail: "The channel binding is saved.",
        label: "Connected",
      };
    case "expired":
      return {
        detail: "Start a new pairing session.",
        label: "QR code expired",
      };
    case "failed":
      return {
        detail: "Start again after checking the WeChat account.",
        label: "Pairing failed",
      };
    case "idle":
      return {
        detail: "Start pairing to create a QR code.",
        label: "Ready to pair",
      };
    case "qr_pending":
      return {
        detail: "Waiting for the QR code to be scanned.",
        label: "Scan QR code",
      };
    case "scanned":
      return {
        detail: "Confirm the login on your WeChat device.",
        label: "Confirm on device",
      };
    case null:
      return {
        detail: "Start pairing to create a QR code.",
        label: "Ready to pair",
      };
  }
}

function isWeChatPairingPollingStatus(status: WeChatPairingStatus): boolean {
  return status === "qr_pending" || status === "scanned";
}

function toEmbeddableQrImageSrc(value: string): string | null {
  if (value.startsWith("data:image/")) {
    return value;
  }

  return null;
}

function mergePairing(
  current: WeChatAgentChannelPairingFieldsFragment | null,
  next: WeChatAgentChannelPairingFieldsFragment,
): WeChatAgentChannelPairingFieldsFragment {
  return {
    ...next,
    qrCodeImageSrc: next.qrCodeImageSrc ?? current?.qrCodeImageSrc ?? null,
  };
}

function useWeChatPairingPolling({
  agentId,
  poll,
  appId,
  qrToken,
  shouldPoll,
}: {
  agentId: AgentId;
  poll: (input: PollWeChatAgentChannelPairingInput) => void;
  appId: AppId;
  qrToken: string | null;
  shouldPoll: boolean;
}) {
  useEffect(() => {
    if (!shouldPoll || qrToken === null) {
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      poll({ agentId, appId, qrToken });
    }, WECHAT_POLL_INTERVAL_MS);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [agentId, poll, appId, qrToken, shouldPoll]);
}

export function WeChatChannelInlineSetup({
  agent,
  onSuccess,
}: {
  agent: ChannelInlineSetupAgent;
  onSuccess?: () => void;
}) {
  const invalidateChannelBindings = useInvalidateAgentChannelBindings(agent.appId, agent.id);
  const [pairing, setPairing] = useState<WeChatAgentChannelPairingFieldsFragment | null>(null);
  const typedAgentId = toAgentId(agent.id);
  const typedAppId = toAppId(agent.appId);

  const startMutation = useMutation({
    mutationFn: startWeChatAgentChannelPairing,
    onSuccess: async (result) => {
      setPairing(result);
      await invalidateChannelBindings();
    },
  });
  const pollMutation = useMutation({
    mutationFn: pollWeChatAgentChannelPairing,
    onSuccess: async (result) => {
      setPairing((current) => mergePairing(current, result));

      if (result.status === "confirmed" && result.binding) {
        await invalidateChannelBindings();
        onSuccess?.();
      }
    },
  });

  const qrToken = pairing?.qrToken ?? null;
  const shouldPoll =
    agent.status === "published" &&
    qrToken !== null &&
    pairing !== null &&
    isWeChatPairingPollingStatus(pairing.status) &&
    !startMutation.isPending &&
    !pollMutation.isPending;
  const pollPairing = pollMutation.mutate;

  useWeChatPairingPolling({
    agentId: typedAgentId,
    poll: pollPairing,
    appId: typedAppId,
    qrToken,
    shouldPoll,
  });

  function handleStartPairing() {
    startMutation.mutate({ agentId: typedAgentId, appId: typedAppId });
  }

  function handlePollNow() {
    if (!qrToken || pollMutation.isPending) {
      return;
    }

    pollMutation.mutate({
      agentId: typedAgentId,
      appId: typedAppId,
      qrToken,
    });
  }

  const status = pairing?.status ?? null;
  const statusCopy = getWeChatPairingStatusCopy(status);
  const embeddedQrImage = pairing?.qrCodeImageSrc
    ? toEmbeddableQrImageSrc(pairing.qrCodeImageSrc)
    : null;
  const qrPayload = pairing?.qrCodeImageSrc ?? pairing?.qrToken ?? null;
  const canStart = agent.status === "published" && !startMutation.isPending;

  return (
    <section className="border-border bg-card rounded-lg border p-4">
      <div className="grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-foreground text-sm font-semibold">QR pairing</div>
            <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Personal WeChat uses the iLink QR-paired bot identity. Credentials stay server-side
              after confirmation.
            </div>
          </div>
          <Button disabled={!canStart} onClick={handleStartPairing} type="button">
            {startMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {pairing ? "Restart" : "Start"}
          </Button>
        </div>

        <div className="border-border-subtle bg-muted/20 rounded-md border px-3 py-2 text-xs leading-relaxed">
          <div className="text-foreground font-medium">{statusCopy.label}</div>
          <div className="text-muted-foreground mt-0.5">{statusCopy.detail}</div>
          {pairing?.lastErrorCode ? (
            <span className="text-destructive ml-1">({pairing.lastErrorCode})</span>
          ) : null}
        </div>

        {qrPayload ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="border-border-subtle bg-background flex size-52 items-center justify-center rounded-md border p-3">
              {embeddedQrImage ? (
                <img
                  alt="WeChat pairing QR code"
                  className="max-h-full max-w-full"
                  src={embeddedQrImage}
                />
              ) : (
                <QRCodeSVG
                  className="max-h-full max-w-full"
                  level="M"
                  size={176}
                  value={qrPayload}
                />
              )}
            </div>
            <div className="flex gap-2">
              <Button
                disabled={!qrToken || pollMutation.isPending || status === "confirmed"}
                onClick={handlePollNow}
                type="button"
                variant="outline"
              >
                {pollMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Check
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {agent.status !== "published" ? (
        <div className="border-amber/30 bg-amber-bg text-amber-fg mt-4 rounded-md border px-3 py-2 text-xs">
          Publish this Agent before connecting WeChat.
        </div>
      ) : null}
      {startMutation.error || pollMutation.error ? (
        <div className="border-ember/25 bg-ember-bg text-ember-fg mt-4 rounded-md border px-3 py-2 text-xs">
          {startMutation.error instanceof Error
            ? startMutation.error.message
            : pollMutation.error instanceof Error
              ? pollMutation.error.message
              : "WeChat setup failed."}
        </div>
      ) : null}
    </section>
  );
}
