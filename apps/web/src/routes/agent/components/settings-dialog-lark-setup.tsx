import type { AgentId } from "@mosoo/contracts/id";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  createLarkAgentChannelBinding,
  pollLarkAgentChannelRegistration,
  startLarkAgentChannelRegistration,
} from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import type {
  LarkAgentChannelRegistrationFieldsFragment,
  LarkConnectionMode,
  LarkDomain,
  PollLarkAgentChannelRegistrationInput,
} from "@/gql/graphql";
import { toAgentId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import type { ChannelInlineSetupAgent } from "./settings-dialog-channel-agent";

const LARK_DOMAIN_OPTIONS: { label: string; value: LarkDomain }[] = [
  { label: "Feishu", value: "feishu" },
  { label: "Lark", value: "lark" },
];

const LARK_CONNECTION_MODE_OPTIONS: {
  description: string;
  label: string;
  value: LarkConnectionMode;
}[] = [
  {
    description: "Inbound webhook. You'll need to copy two values from the Lark Open Platform.",
    label: "Webhook",
    value: "webhook",
  },
];

const LARK_REGISTRATION_POLL_INTERVAL_MS = 3_000;

const LARK_OPEN_PLATFORM_ORIGIN: Record<LarkDomain, string> = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
};

function getLarkDomainLabel(domain: LarkDomain): string {
  return domain === "feishu" ? "Feishu" : "Lark";
}

export function getLarkEventConfigUrl(domain: LarkDomain, appId: string): string | null {
  const trimmed = appId.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return `${LARK_OPEN_PLATFORM_ORIGIN[domain]}/app/${encodeURIComponent(trimmed)}/event-subscriptions/event-config`;
}

export function getLarkRegistrationStatusCopy(
  status: LarkAgentChannelRegistrationFieldsFragment["status"] | null,
  connectionMode: LarkConnectionMode = "webhook",
): string {
  switch (status) {
    case "access_denied":
      return "Authorization was denied. Use manual setup or start again.";
    case "confirmed":
      return connectionMode === "websocket"
        ? "App created. App ID and App Secret were copied — you're ready to save."
        : "App created. App ID and App Secret were copied into the manual fields.";
    case "expired":
      return "The authorization session expired. Start again or use manual setup.";
    case "failed":
      return "Scan-to-create failed. Manual setup is still available.";
    case "qr_pending":
      return "Open the authorization link and scan it with Lark / Feishu on your phone.";
    case "slow_down":
      return "The platform asked us to poll more slowly. Keep the authorization page open.";
    case null:
      return connectionMode === "websocket"
        ? "Create a Lark / Feishu app by scan, then click Save."
        : "Create a Lark / Feishu app by scan first, then finish the webhook fields below.";
  }
}

function isTerminalRegistrationStatus(
  status: LarkAgentChannelRegistrationFieldsFragment["status"],
): boolean {
  return (
    status === "access_denied" ||
    status === "confirmed" ||
    status === "expired" ||
    status === "failed"
  );
}

function mergeRegistration(
  current: LarkAgentChannelRegistrationFieldsFragment | null,
  next: LarkAgentChannelRegistrationFieldsFragment,
): LarkAgentChannelRegistrationFieldsFragment {
  return {
    ...next,
    deviceCode: next.deviceCode ?? current?.deviceCode ?? null,
    expireIn: next.expireIn ?? current?.expireIn ?? null,
    interval: next.interval ?? current?.interval ?? null,
    qrUrl: next.qrUrl ?? current?.qrUrl ?? null,
    userCode: next.userCode ?? current?.userCode ?? null,
  };
}

function useLarkRegistrationPolling({
  agentId,
  deviceCode,
  domain,
  poll,
  shouldPoll,
  status,
}: {
  agentId: AgentId;
  deviceCode: string | null;
  domain: LarkDomain;
  poll: (input: PollLarkAgentChannelRegistrationInput) => void;
  shouldPoll: boolean;
  status: LarkAgentChannelRegistrationFieldsFragment["status"] | null;
}) {
  useEffect(() => {
    if (!shouldPoll || deviceCode === null) {
      return;
    }

    const delayMs =
      status === "slow_down"
        ? LARK_REGISTRATION_POLL_INTERVAL_MS * 2
        : LARK_REGISTRATION_POLL_INTERVAL_MS;
    const timeoutId = globalThis.setTimeout(() => {
      poll({ agentId, deviceCode, domain });
    }, delayMs);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [agentId, deviceCode, domain, poll, shouldPoll, status]);
}

export function LarkChannelInlineSetup({
  agent,
  onSuccess,
}: {
  agent: ChannelInlineSetupAgent;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [connectionMode, setConnectionMode] = useState<LarkConnectionMode>("webhook");
  const [domain, setDomain] = useState<LarkDomain>("feishu");
  const [encryptKey, setEncryptKey] = useState("");
  const [registration, setRegistration] =
    useState<LarkAgentChannelRegistrationFieldsFragment | null>(null);
  const [verificationToken, setVerificationToken] = useState("");
  const typedAgentId = toAgentId(agent.id);

  const registrationStartMutation = useMutation({
    mutationFn: startLarkAgentChannelRegistration,
    onSuccess: async (result) => {
      setRegistration(result);
      setDomain(result.domain);
      await queryClient.invalidateQueries({ queryKey: agentKeys.channelBindings(agent.id) });
    },
  });
  const registrationPollMutation = useMutation({
    mutationFn: pollLarkAgentChannelRegistration,
    onSuccess: async (result) => {
      setRegistration((current) => mergeRegistration(current, result));
      setDomain(result.domain);

      if (result.status === "confirmed" && result.appId && result.appSecret) {
        setAppId(result.appId);
        setAppSecret(result.appSecret);
      }
      await queryClient.invalidateQueries({ queryKey: agentKeys.channelBindings(agent.id) });
    },
  });
  const saveMutation = useMutation({
    mutationFn: createLarkAgentChannelBinding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.channelBindings(agent.id) });
      onSuccess?.();
    },
  });

  const canSubmit =
    agent.status === "published" &&
    appId.trim().length > 0 &&
    appSecret.trim().length > 0 &&
    encryptKey.trim().length > 0 &&
    verificationToken.trim().length > 0 &&
    !saveMutation.isPending;

  const registrationDeviceCode = registration?.deviceCode ?? null;
  const registrationDomain = registration?.domain ?? domain;
  const shouldPollRegistration =
    agent.status === "published" &&
    registration !== null &&
    registrationDeviceCode !== null &&
    !isTerminalRegistrationStatus(registration.status) &&
    !registrationStartMutation.isPending &&
    !registrationPollMutation.isPending;
  const pollRegistration = registrationPollMutation.mutate;

  useLarkRegistrationPolling({
    agentId: typedAgentId,
    deviceCode: registrationDeviceCode,
    domain: registrationDomain,
    poll: pollRegistration,
    shouldPoll: shouldPollRegistration,
    status: registration?.status ?? null,
  });

  function handleStartRegistration() {
    registrationStartMutation.mutate({
      agentId: typedAgentId,
      domain,
    });
  }

  function handlePollRegistration() {
    if (!registrationDeviceCode || registrationPollMutation.isPending) {
      return;
    }

    registrationPollMutation.mutate({
      agentId: typedAgentId,
      deviceCode: registrationDeviceCode,
      domain: registrationDomain,
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    saveMutation.mutate({
      agentId: typedAgentId,
      appId: appId.trim(),
      appSecret: appSecret.trim(),
      connectionMode,
      domain,
      encryptKey: connectionMode === "webhook" ? encryptKey.trim() : null,
      verificationToken: connectionMode === "webhook" ? verificationToken.trim() : null,
    });
  }

  const registrationStatus = registration?.status ?? null;
  const registrationError =
    registrationStartMutation.error ??
    registrationPollMutation.error ??
    (registration?.lastErrorCode ? new Error(registration.lastErrorCode) : null);
  const eventConfigUrl = getLarkEventConfigUrl(domain, appId);
  const domainLabel = getLarkDomainLabel(domain);

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <section className="border-border bg-card rounded-lg border p-4">
        <div className="grid gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-foreground text-sm font-semibold">Scan-to-create</div>
              <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Scan creates a Lark / Feishu app and pre-fills App ID and App Secret.{" "}
                {connectionMode === "websocket"
                  ? "WebSocket mode is set up the moment Save is clicked."
                  : "Webhook fields still come from the Lark Open Platform event-subscription page."}
              </div>
            </div>
            <Button
              disabled={agent.status !== "published" || registrationStartMutation.isPending}
              onClick={handleStartRegistration}
              type="button"
            >
              {registrationStartMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Start
            </Button>
          </div>

          <div className="border-border-subtle bg-muted/20 rounded-md border px-3 py-2 text-xs leading-relaxed">
            {getLarkRegistrationStatusCopy(registrationStatus, connectionMode)}
          </div>

          {registration?.qrUrl ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="border-border-subtle bg-background flex size-52 shrink-0 items-center justify-center rounded-md border p-3">
                <QRCodeSVG
                  className="max-h-full max-w-full"
                  level="M"
                  size={176}
                  value={registration.qrUrl}
                />
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <Button asChild variant="outline">
                  <a href={registration.qrUrl} rel="noreferrer" target="_blank">
                    <ExternalLink className="size-4" />
                    Open authorization
                  </a>
                </Button>
                <Button
                  disabled={
                    !registrationDeviceCode ||
                    registrationPollMutation.isPending ||
                    registrationStatus === "confirmed"
                  }
                  onClick={handlePollRegistration}
                  type="button"
                  variant="outline"
                >
                  {registrationPollMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Check
                </Button>
                {registration.userCode ? (
                  <code className="bg-muted text-muted-foreground rounded-md border px-2 py-1 text-[11px]">
                    {registration.userCode}
                  </code>
                ) : null}
              </div>
            </div>
          ) : null}

          {registrationError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              {registrationError.message}
            </div>
          ) : null}
        </div>
      </section>

      <section className="border-border bg-card rounded-lg border p-4">
        <div className="grid gap-4">
          <div className="text-foreground text-sm font-semibold">Configuration</div>

          <div className="grid gap-1.5">
            <Label>Connection mode</Label>
            <div className="bg-muted/30 grid rounded-md border p-1">
              {LARK_CONNECTION_MODE_OPTIONS.map((option) => (
                <button
                  className={cn(
                    "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                    connectionMode === option.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  key={option.value}
                  onClick={() => {
                    setConnectionMode(option.value);
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="text-muted-foreground text-xs leading-relaxed">
              {LARK_CONNECTION_MODE_OPTIONS.find((option) => option.value === connectionMode)
                ?.description ?? ""}
              {" Values entered for one mode aren't applied to the other on save."}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Open Platform</Label>
            <div className="bg-muted/30 grid grid-cols-2 rounded-md border p-1">
              {LARK_DOMAIN_OPTIONS.map((option) => (
                <button
                  className={cn(
                    "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                    domain === option.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  key={option.value}
                  onClick={() => {
                    setDomain(option.value);
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lark-app-id">App ID</Label>
            <Input
              autoComplete="off"
              id="lark-app-id"
              onChange={(event) => {
                setAppId(event.target.value);
              }}
              value={appId}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lark-app-secret">App Secret</Label>
            <Input
              autoComplete="off"
              id="lark-app-secret"
              onChange={(event) => {
                setAppSecret(event.target.value);
              }}
              type="password"
              value={appSecret}
            />
          </div>

          {connectionMode === "webhook" ? (
            <>
              {eventConfigUrl ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild variant="outline">
                    <a href={eventConfigUrl} rel="noreferrer" target="_blank">
                      <ExternalLink className="size-4" />
                      Open {domainLabel} event-subscription page
                    </a>
                  </Button>
                  <div className="text-muted-foreground text-xs">
                    Copy Verification Token + Encrypt Key from there.
                  </div>
                </div>
              ) : null}
              <div className="grid gap-1.5">
                <Label htmlFor="lark-verification-token">Verification Token</Label>
                <Input
                  autoComplete="off"
                  id="lark-verification-token"
                  onChange={(event) => {
                    setVerificationToken(event.target.value);
                  }}
                  type="password"
                  value={verificationToken}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="lark-encrypt-key">Encrypt Key</Label>
                <Input
                  autoComplete="off"
                  id="lark-encrypt-key"
                  onChange={(event) => {
                    setEncryptKey(event.target.value);
                  }}
                  type="password"
                  value={encryptKey}
                />
              </div>
            </>
          ) : null}
        </div>

        {agent.status !== "published" ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Publish this Agent before connecting Lark / 飞书.
          </div>
        ) : null}
        {saveMutation.error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            {saveMutation.error instanceof Error
              ? saveMutation.error.message
              : "Lark / 飞书 setup failed."}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <Button disabled={!canSubmit} type="submit">
            {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </section>
    </form>
  );
}
