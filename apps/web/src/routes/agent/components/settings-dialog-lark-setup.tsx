import type { AgentId, AppId } from "@mosoo/contracts/id";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useReducer } from "react";
import type { Dispatch, FormEvent } from "react";

import {
  createLarkAgentChannelBinding,
  pollLarkAgentChannelRegistration,
  startLarkAgentChannelRegistration,
} from "@/domains/agent/api/agent-client";
import { useInvalidateAgentChannelBindings } from "@/domains/agent/query/agent-queries";
import type {
  LarkAgentChannelRegistrationFieldsFragment,
  LarkConnectionMode,
  LarkDomain,
  PollLarkAgentChannelRegistrationInput,
} from "@/gql/graphql";
import { toAgentId, toAppId } from "@/routes/typed-id";
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

function getLarkEventConfigUrl(domain: LarkDomain, larkAppId: string): string | null {
  const trimmed = larkAppId.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return `${LARK_OPEN_PLATFORM_ORIGIN[domain]}/app/${encodeURIComponent(trimmed)}/event-subscriptions/event-config`;
}

function getLarkRegistrationStatusCopy(
  status: LarkAgentChannelRegistrationFieldsFragment["status"] | null,
  connectionMode: LarkConnectionMode = "webhook",
): string {
  switch (status) {
    case "access_denied":
      return "Authorization was denied. Use manual setup or start again.";
    case "confirmed":
      return connectionMode === "websocket"
        ? "App created. App ID and App Secret were copied. You're ready to save."
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
  appId,
  shouldPoll,
  status,
}: {
  agentId: AgentId;
  deviceCode: string | null;
  domain: LarkDomain;
  poll: (input: PollLarkAgentChannelRegistrationInput) => void;
  appId: AppId;
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
      poll({ agentId, deviceCode, domain, appId });
    }, delayMs);

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [agentId, deviceCode, domain, poll, appId, shouldPoll, status]);
}

interface LarkChannelInlineSetupState {
  larkAppId: string;
  appSecret: string;
  connectionMode: LarkConnectionMode;
  domain: LarkDomain;
  encryptKey: string;
  registration: LarkAgentChannelRegistrationFieldsFragment | null;
  verificationToken: string;
}

type LarkChannelInlineSetupAction =
  | { type: "changeLarkAppId"; larkAppId: string }
  | { type: "changeAppSecret"; appSecret: string }
  | { type: "changeConnectionMode"; connectionMode: LarkConnectionMode }
  | { type: "changeDomain"; domain: LarkDomain }
  | { type: "changeEncryptKey"; encryptKey: string }
  | { type: "changeVerificationToken"; verificationToken: string }
  | { type: "registrationPolled"; registration: LarkAgentChannelRegistrationFieldsFragment }
  | { type: "registrationStarted"; registration: LarkAgentChannelRegistrationFieldsFragment };

type LarkChannelInlineSetupDispatch = Dispatch<LarkChannelInlineSetupAction>;

const LARK_CHANNEL_INLINE_SETUP_INITIAL_STATE: LarkChannelInlineSetupState = {
  larkAppId: "",
  appSecret: "",
  connectionMode: "webhook",
  domain: "feishu",
  encryptKey: "",
  registration: null,
  verificationToken: "",
};

function larkChannelInlineSetupReducer(
  state: LarkChannelInlineSetupState,
  action: LarkChannelInlineSetupAction,
): LarkChannelInlineSetupState {
  switch (action.type) {
    case "changeLarkAppId":
      return { ...state, larkAppId: action.larkAppId };
    case "changeAppSecret":
      return { ...state, appSecret: action.appSecret };
    case "changeConnectionMode":
      return { ...state, connectionMode: action.connectionMode };
    case "changeDomain":
      return { ...state, domain: action.domain };
    case "changeEncryptKey":
      return { ...state, encryptKey: action.encryptKey };
    case "changeVerificationToken":
      return { ...state, verificationToken: action.verificationToken };
    case "registrationPolled": {
      const nextState = {
        ...state,
        domain: action.registration.domain,
        registration: mergeRegistration(state.registration, action.registration),
      };

      if (
        action.registration.status === "confirmed" &&
        action.registration.appId &&
        action.registration.appSecret
      ) {
        return {
          ...nextState,
          larkAppId: action.registration.appId,
          appSecret: action.registration.appSecret,
        };
      }

      return nextState;
    }
    case "registrationStarted":
      return {
        ...state,
        domain: action.registration.domain,
        registration: action.registration,
      };
  }
}

export function LarkChannelInlineSetup({
  agent,
  onSuccess,
}: {
  agent: ChannelInlineSetupAgent;
  onSuccess?: () => void;
}) {
  const invalidateChannelBindings = useInvalidateAgentChannelBindings(agent.appId, agent.id);
  const [state, dispatch] = useReducer(
    larkChannelInlineSetupReducer,
    LARK_CHANNEL_INLINE_SETUP_INITIAL_STATE,
  );
  const {
    larkAppId,
    appSecret,
    connectionMode,
    domain,
    encryptKey,
    registration,
    verificationToken,
  } = state;
  const typedAgentId = toAgentId(agent.id);
  const typedAppId = toAppId(agent.appId);

  const registrationStartMutation = useMutation({
    mutationFn: startLarkAgentChannelRegistration,
    onSuccess: async (result) => {
      dispatch({ registration: result, type: "registrationStarted" });
      await invalidateChannelBindings();
    },
  });
  const registrationPollMutation = useMutation({
    mutationFn: pollLarkAgentChannelRegistration,
    onSuccess: async (result) => {
      dispatch({ registration: result, type: "registrationPolled" });
      await invalidateChannelBindings();
    },
  });
  const saveMutation = useMutation({
    mutationFn: createLarkAgentChannelBinding,
    onSuccess: async () => {
      await invalidateChannelBindings();
      onSuccess?.();
    },
  });

  const canSubmit =
    agent.status === "published" &&
    larkAppId.trim().length > 0 &&
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
    appId: typedAppId,
    shouldPoll: shouldPollRegistration,
    status: registration?.status ?? null,
  });

  function handleStartRegistration() {
    registrationStartMutation.mutate({
      agentId: typedAgentId,
      domain,
      appId: typedAppId,
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
      appId: typedAppId,
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    saveMutation.mutate({
      agentId: typedAgentId,
      larkAppId: larkAppId.trim(),
      appSecret: appSecret.trim(),
      connectionMode,
      domain,
      encryptKey: connectionMode === "webhook" ? encryptKey.trim() : null,
      appId: typedAppId,
      verificationToken: connectionMode === "webhook" ? verificationToken.trim() : null,
    });
  }

  const registrationStatus = registration?.status ?? null;
  const registrationError =
    registrationStartMutation.error ??
    registrationPollMutation.error ??
    (registration?.lastErrorCode ? new Error(registration.lastErrorCode) : null);
  const eventConfigUrl = getLarkEventConfigUrl(domain, larkAppId);
  const domainLabel = getLarkDomainLabel(domain);

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <LarkRegistrationSection
        agentStatus={agent.status}
        connectionMode={connectionMode}
        onPoll={handlePollRegistration}
        onStart={handleStartRegistration}
        pollPending={registrationPollMutation.isPending}
        registration={registration}
        registrationDeviceCode={registrationDeviceCode}
        registrationError={registrationError}
        registrationStatus={registrationStatus}
        startPending={registrationStartMutation.isPending}
      />

      <LarkConfigurationSection
        agentStatus={agent.status}
        canSubmit={canSubmit}
        dispatch={dispatch}
        domainLabel={domainLabel}
        eventConfigUrl={eventConfigUrl}
        saveError={saveMutation.error}
        savePending={saveMutation.isPending}
        state={state}
      />
    </form>
  );
}

function LarkRegistrationSection({
  agentStatus,
  connectionMode,
  onPoll,
  onStart,
  pollPending,
  registration,
  registrationDeviceCode,
  registrationError,
  registrationStatus,
  startPending,
}: {
  agentStatus: ChannelInlineSetupAgent["status"];
  connectionMode: LarkConnectionMode;
  onPoll: () => void;
  onStart: () => void;
  pollPending: boolean;
  registration: LarkAgentChannelRegistrationFieldsFragment | null;
  registrationDeviceCode: string | null;
  registrationError: Error | null;
  registrationStatus: LarkAgentChannelRegistrationFieldsFragment["status"] | null;
  startPending: boolean;
}) {
  return (
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
            disabled={agentStatus !== "published" || startPending}
            onClick={onStart}
            type="button"
          >
            {startPending ? <Loader2 className="size-4 animate-spin" /> : null}
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
                  !registrationDeviceCode || pollPending || registrationStatus === "confirmed"
                }
                onClick={onPoll}
                type="button"
                variant="outline"
              >
                {pollPending ? (
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
          <div className="border-ember/25 bg-ember-bg text-ember-fg rounded-md border px-3 py-2 text-xs">
            {registrationError.message}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LarkConfigurationSection({
  agentStatus,
  canSubmit,
  dispatch,
  domainLabel,
  eventConfigUrl,
  saveError,
  savePending,
  state,
}: {
  agentStatus: ChannelInlineSetupAgent["status"];
  canSubmit: boolean;
  dispatch: LarkChannelInlineSetupDispatch;
  domainLabel: string;
  eventConfigUrl: string | null;
  saveError: Error | null;
  savePending: boolean;
  state: LarkChannelInlineSetupState;
}) {
  const { larkAppId, appSecret, connectionMode, domain, encryptKey, verificationToken } = state;

  return (
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
                  dispatch({ connectionMode: option.value, type: "changeConnectionMode" });
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
          <Label>Open platform</Label>
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
                  dispatch({ domain: option.value, type: "changeDomain" });
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
              dispatch({ larkAppId: event.target.value, type: "changeLarkAppId" });
            }}
            value={larkAppId}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="lark-app-secret">App Secret</Label>
          <Input
            autoComplete="off"
            id="lark-app-secret"
            onChange={(event) => {
              dispatch({ appSecret: event.target.value, type: "changeAppSecret" });
            }}
            type="password"
            value={appSecret}
          />
        </div>

        {connectionMode === "webhook" ? (
          <LarkWebhookFields
            dispatch={dispatch}
            domainLabel={domainLabel}
            encryptKey={encryptKey}
            eventConfigUrl={eventConfigUrl}
            verificationToken={verificationToken}
          />
        ) : null}
      </div>

      {agentStatus !== "published" ? (
        <div className="border-amber/30 bg-amber-bg text-amber-fg mt-4 rounded-md border px-3 py-2 text-xs">
          Publish this Agent before connecting Feishu.
        </div>
      ) : null}
      {saveError ? (
        <div className="border-ember/25 bg-ember-bg text-ember-fg mt-4 rounded-md border px-3 py-2 text-xs">
          {saveError.message}
        </div>
      ) : null}

      <div className="mt-4 flex justify-end">
        <Button disabled={!canSubmit} type="submit">
          {savePending ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </section>
  );
}

function LarkWebhookFields({
  dispatch,
  domainLabel,
  encryptKey,
  eventConfigUrl,
  verificationToken,
}: {
  dispatch: LarkChannelInlineSetupDispatch;
  domainLabel: string;
  encryptKey: string;
  eventConfigUrl: string | null;
  verificationToken: string;
}) {
  return (
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
            dispatch({
              type: "changeVerificationToken",
              verificationToken: event.target.value,
            });
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
            dispatch({ encryptKey: event.target.value, type: "changeEncryptKey" });
          }}
          type="password"
          value={encryptKey}
        />
      </div>
    </>
  );
}
