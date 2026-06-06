import type { OrganizationInvitation } from "@mosoo/contracts/organization";
import { sleepPromise } from "@mosoo/effects";
import { ArrowRight, Building2, Loader2, Lock, MailCheck, Plus, Users } from "lucide-react";
import { useCallback, useEffect, useReducer } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "../../app/session-provider";
import {
  onboardingBootstrap,
  onboardingDiscover,
} from "../../domains/onboarding/api/onboarding-client";
import type { DiscoverResult } from "../../domains/onboarding/api/onboarding-client";
import {
  acceptOrganizationInvitation,
  pendingOrganizationInvitations,
  requestOrganizationAccess,
} from "../../domains/organization/api/organization-client";
import { isTruthy } from "../../shared/lib/truthiness";
import { toOrganizationId, toOrganizationInvitationId } from "../typed-id";
import { OnboardingChoiceScreen } from "./onboarding-choice";
import { getOnboardingDomainOrganizationName } from "./onboarding-domain";
type OnboardingStep = "loading" | "invitations" | "choice" | "discovery" | "provisioning";
type ProvisioningAction = "join" | "create";
type OnboardingBootstrapInput = NonNullable<Parameters<typeof onboardingBootstrap>[1]>;

interface OnboardingState {
  bootstrapping: boolean;
  discovery: DiscoverResult | null;
  error: string | null;
  invitations: OrganizationInvitation[];
  provisioningAction: ProvisioningAction;
  step: OnboardingStep;
}

type OnboardingAction =
  | { type: "bootstrapFailed"; error: string; step: OnboardingStep }
  | { type: "bootstrapStarted"; provisioningAction: ProvisioningAction }
  | { type: "loadFailed"; error: string }
  | {
      type: "loadSucceeded";
      discovery: DiscoverResult;
      invitations: OrganizationInvitation[];
      step: OnboardingStep;
    };

const ONBOARDING_INITIAL_STATE: OnboardingState = {
  bootstrapping: false,
  discovery: null,
  error: null,
  invitations: [],
  provisioningAction: "create",
  step: "loading",
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function toOnboardingBootstrapInput(input?: {
  name?: string;
  organizationId?: string;
}): OnboardingBootstrapInput | undefined {
  if (input === undefined) {
    return undefined;
  }

  const nextInput: OnboardingBootstrapInput = {};

  if (input.name !== undefined) {
    nextInput.name = input.name;
  }

  if (input.organizationId !== undefined) {
    nextInput.organizationId = toOrganizationId(input.organizationId);
  }

  return nextInput;
}

function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "bootstrapFailed":
      return { ...state, bootstrapping: false, error: action.error, step: action.step };
    case "bootstrapStarted":
      return {
        ...state,
        bootstrapping: true,
        error: null,
        provisioningAction: action.provisioningAction,
        step: "provisioning",
      };
    case "loadFailed":
      return { ...state, error: action.error, step: "discovery" };
    case "loadSucceeded":
      return {
        ...state,
        discovery: action.discovery,
        invitations: action.invitations,
        step: action.step,
      };
  }
}

function getNextOnboardingStep(input: {
  discovery: DiscoverResult;
  invitations: OrganizationInvitation[];
}): OnboardingStep {
  if (input.invitations.length > 0) {
    return "invitations";
  }

  return input.discovery.orgs.length === 0 ? "choice" : "discovery";
}

export function Onboarding() {
  const { refreshPendingInvitations, refreshOrganizations, setActiveOrganizationId, user } =
    useAppSession();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(onboardingReducer, ONBOARDING_INITIAL_STATE);
  const { bootstrapping, discovery, error, invitations, provisioningAction, step } = state;

  const handleBootstrap = useCallback(
    async (action: "join" | "create", input?: { name?: string; organizationId?: string }) => {
      const nextProvisioningAction: ProvisioningAction = action === "join" ? "join" : "create";

      dispatch({ provisioningAction: nextProvisioningAction, type: "bootstrapStarted" });
      try {
        const result = await onboardingBootstrap(action, toOnboardingBootstrapInput(input));
        await Promise.all([
          refreshPendingInvitations(),
          refreshOrganizations(),
          setActiveOrganizationId(result.organization.id),
          sleepPromise(800),
        ]);
        void navigate("/", { replace: true });
      } catch (caughtError: unknown) {
        dispatch({
          error: getErrorMessage(caughtError) || "Something went wrong",
          step: action === "join" ? "discovery" : "choice",
          type: "bootstrapFailed",
        });
      }
    },
    [navigate, refreshOrganizations, refreshPendingInvitations, setActiveOrganizationId],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadOnboarding() {
      try {
        const [pendingInvites, result] = await Promise.all([
          pendingOrganizationInvitations(),
          onboardingDiscover(),
        ]);

        if (cancelled) {
          return;
        }

        if (result.isPublicEmail) {
          await handleBootstrap("create");
          return;
        }

        dispatch({
          discovery: result,
          invitations: pendingInvites,
          step: getNextOnboardingStep({ discovery: result, invitations: pendingInvites }),
          type: "loadSucceeded",
        });
      } catch (caughtError: unknown) {
        if (cancelled) {
          return;
        }

        const message = getErrorMessage(caughtError);

        if (message === "Unauthorized.") {
          void navigate("/login", { replace: true });
          return;
        }

        dispatch({ error: message, type: "loadFailed" });
      }
    }

    void loadOnboarding();

    return () => {
      cancelled = true;
    };
  }, [handleBootstrap, navigate]);

  const handleAcceptInvitation = async (invitationId: string) => {
    dispatch({ provisioningAction: "join", type: "bootstrapStarted" });

    try {
      const organization = await acceptOrganizationInvitation(
        toOrganizationInvitationId(invitationId),
      );
      await Promise.all([
        refreshPendingInvitations(),
        refreshOrganizations(),
        setActiveOrganizationId(organization.id),
        sleepPromise(800),
      ]);
      void navigate("/", { replace: true });
    } catch (nextError: unknown) {
      dispatch({
        error: getErrorMessage(nextError) || "Something went wrong",
        step: "invitations",
        type: "bootstrapFailed",
      });
    }
  };

  const handleRequestAccess = async (organizationId: string) => {
    dispatch({ provisioningAction: "create", type: "bootstrapStarted" });

    try {
      await requestOrganizationAccess(toOrganizationId(organizationId));
      await handleBootstrap("create");
    } catch (nextError: unknown) {
      dispatch({
        error: getErrorMessage(nextError) || "Something went wrong",
        step: "discovery",
        type: "bootstrapFailed",
      });
    }
  };

  if (step === "loading") {
    return <OnboardingLoadingScreen />;
  }

  if (step === "provisioning") {
    return <OnboardingProvisioningScreen provisioningAction={provisioningAction} />;
  }

  // ── Discovery Screen ──
  const orgs = discovery?.orgs ?? [];
  const joinableOrgs = orgs.filter((o) => o.joinPolicy === "auto");
  const inviteOnlyOrgs = orgs.filter((o) => o.joinPolicy === "invite_only");
  const domainOrganizationName = getOnboardingDomainOrganizationName(discovery?.domain);

  if (step === "invitations") {
    return (
      <OnboardingInvitationsScreen
        bootstrapping={bootstrapping}
        error={error}
        invitations={invitations}
        onAcceptInvitation={handleAcceptInvitation}
        onCreate={() => {
          void handleBootstrap("create");
        }}
      />
    );
  }

  if (step === "choice") {
    return (
      <OnboardingChoiceScreen
        bootstrapping={bootstrapping}
        domain={discovery?.domain}
        error={error}
        onCreate={(name) => void handleBootstrap("create", { name })}
      />
    );
  }

  return (
    <OnboardingDiscoveryScreen
      bootstrapping={bootstrapping}
      discovery={discovery}
      domainOrganizationName={domainOrganizationName}
      error={error}
      inviteOnlyOrgs={inviteOnlyOrgs}
      joinableOrgs={joinableOrgs}
      onCreateTeam={(name) => {
        void handleBootstrap("create", { name });
      }}
      onJoin={(organizationId) => {
        void handleBootstrap("join", { organizationId });
      }}
      onRequestAccess={handleRequestAccess}
      userName={user?.name ?? null}
    />
  );
}

function OnboardingLoadingScreen() {
  return (
    <div className="bg-background fixed inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="text-primary size-8 animate-spin" />
        <p className="text-muted-foreground text-sm">Setting things up…</p>
      </div>
    </div>
  );
}

function OnboardingProvisioningScreen({
  provisioningAction,
}: {
  provisioningAction: ProvisioningAction;
}) {
  return (
    <div className="bg-background fixed inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="text-primary size-8 animate-spin" />
        <p className="text-muted-foreground text-sm">
          {provisioningAction === "join"
            ? "Joining an existing organization…"
            : "Creating your organization…"}
        </p>
      </div>
    </div>
  );
}

function OnboardingInvitationsScreen({
  bootstrapping,
  error,
  invitations,
  onAcceptInvitation,
  onCreate,
}: {
  bootstrapping: boolean;
  error: string | null;
  invitations: OrganizationInvitation[];
  onAcceptInvitation: (invitationId: string) => Promise<void>;
  onCreate: () => void;
}) {
  return (
    <div className="bg-background fixed inset-0 flex flex-col">
      <div className="flex items-center px-8 py-5">
        <span className="text-xl font-light tracking-tight">Mosoo</span>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[520px] px-6">
          <div className="mb-6 flex justify-center">
            <div className="border-primary/20 from-primary/20 to-primary/5 flex size-16 items-center justify-center rounded-full border-2 bg-gradient-to-br">
              <MailCheck className="text-primary size-7" />
            </div>
          </div>

          <h2 className="text-foreground text-center text-2xl font-semibold">You have invites</h2>
          <p className="text-muted-foreground mt-2 text-center text-sm">
            Accept one to enter right away, or create your own organization instead.
          </p>

          <div className="mt-8 space-y-3">
            {invitations.map((invitation) => (
              <button
                key={invitation.id}
                aria-label={`Accept invitation to ${invitation.organizationName}`}
                type="button"
                onClick={() => void onAcceptInvitation(invitation.id)}
                disabled={bootstrapping}
                className="group border-border hover:border-primary/30 hover:bg-primary/[0.02] w-full rounded-lg border p-4 text-left transition-all"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-foreground text-sm font-semibold">
                      {invitation.organizationName}
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {invitation.organizationName}
                      {isTruthy(invitation.invitedByName)
                        ? ` · Invited by ${invitation.invitedByName}`
                        : ""}
                    </div>
                  </div>
                  <div className="text-primary flex items-center gap-1 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100">
                    Accept <ArrowRight className="size-3.5" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                onCreate();
              }}
              disabled={bootstrapping}
              className="text-muted-foreground hover:bg-accent/50 hover:text-foreground flex w-full items-center justify-center gap-2 rounded-lg p-3 text-sm font-medium transition-colors"
            >
              <Plus className="size-4" />
              Create my own organization
            </button>
          </div>

          {isTruthy(error) ? (
            <p className="text-destructive mt-4 text-center text-sm">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OnboardingDiscoveryScreen({
  bootstrapping,
  discovery,
  domainOrganizationName,
  error,
  inviteOnlyOrgs,
  joinableOrgs,
  onCreateTeam,
  onJoin,
  onRequestAccess,
  userName,
}: {
  bootstrapping: boolean;
  discovery: DiscoverResult | null;
  domainOrganizationName: string;
  error: string | null;
  inviteOnlyOrgs: DiscoverResult["orgs"];
  joinableOrgs: DiscoverResult["orgs"];
  onCreateTeam: (name: string) => void;
  onJoin: (organizationId: string) => void;
  onRequestAccess: (organizationId: string) => Promise<void>;
  userName: string | null;
}) {
  return (
    <div className="bg-background fixed inset-0 flex flex-col">
      <div className="flex items-center px-10 py-[22px]">
        <img src="/brand/logo-wordmark-onlight.svg" alt="Mosoo" className="block h-[22px]" />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[480px] px-6">
          <div className="mb-6 flex justify-center">
            <div className="bg-ink-100 border-border flex size-16 items-center justify-center rounded-md border">
              <Building2 className="text-accent-press size-7" />
            </div>
          </div>

          <h2 className="text-fg-1 text-center text-[24px] font-semibold tracking-normal">
            Welcome, {userName?.split(" ")[0] ?? "there"}.
          </h2>
          <p className="text-muted-foreground mt-2 text-center text-sm">
            We found organizations on{" "}
            <span className="text-foreground font-medium">@{discovery?.domain}</span>
          </p>

          <div className="mt-8 space-y-3">
            {joinableOrgs.map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => {
                  onJoin(org.id);
                }}
                disabled={bootstrapping}
                className="group border-border hover:border-primary/30 hover:bg-primary/[0.02] flex w-full items-center justify-between rounded-lg border p-4 text-left transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 flex size-10 items-center justify-center rounded-lg">
                    <Users className="text-primary size-5" />
                  </div>
                  <div>
                    <div className="text-foreground text-sm font-semibold">{org.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {org.memberCount} member{org.memberCount !== 1 ? "s" : ""} · Created by{" "}
                      {org.creator}
                    </div>
                  </div>
                </div>
                <div className="text-primary flex items-center gap-1 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100">
                  Join <ArrowRight className="size-3.5" />
                </div>
              </button>
            ))}

            {inviteOnlyOrgs.map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => void onRequestAccess(org.id)}
                disabled={bootstrapping}
                className="border-border flex w-full items-center justify-between rounded-lg border p-4 opacity-60"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-muted flex size-10 items-center justify-center rounded-lg">
                    <Lock className="text-muted-foreground size-5" />
                  </div>
                  <div>
                    <div className="text-foreground text-sm font-semibold">{org.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {org.memberCount} member{org.memberCount !== 1 ? "s" : ""} · Invite only
                    </div>
                  </div>
                </div>
                <div className="text-primary flex items-center gap-1 text-xs font-medium">
                  Request <ArrowRight className="size-3.5" />
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                onCreateTeam(domainOrganizationName);
              }}
              disabled={bootstrapping}
              className="text-muted-foreground hover:bg-accent/50 hover:text-foreground flex w-full items-center justify-center gap-2 rounded-lg p-3 text-sm font-medium transition-colors"
            >
              <Plus className="size-4" />
              Create my own organization
            </button>
          </div>

          {Boolean(error) && <p className="text-destructive mt-4 text-center text-sm">{error}</p>}
        </div>
      </div>
    </div>
  );
}
