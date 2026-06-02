import type { OrganizationInvitation } from "@mosoo/contracts/organization";
import { sleepPromise } from "@mosoo/effects";
import { ArrowRight, Building2, Loader2, Lock, MailCheck, Plus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
type ProvisioningAction = "join" | "create_team" | "create_personal";
type OnboardingBootstrapInput = NonNullable<Parameters<typeof onboardingBootstrap>[1]>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function toOnboardingBootstrapInput(input?: {
  kind?: "personal" | "team";
  name?: string;
  organizationId?: string;
}): OnboardingBootstrapInput | undefined {
  if (input === undefined) {
    return undefined;
  }

  const nextInput: OnboardingBootstrapInput = {};

  if (input.kind !== undefined) {
    nextInput.kind = input.kind;
  }

  if (input.name !== undefined) {
    nextInput.name = input.name;
  }

  if (input.organizationId !== undefined) {
    nextInput.organizationId = toOrganizationId(input.organizationId);
  }

  return nextInput;
}

export function Onboarding() {
  const { refreshPendingInvitations, refreshOrganizations, setActiveOrganizationId, user } =
    useAppSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStep>("loading");
  const [discovery, setDiscovery] = useState<DiscoverResult | null>(null);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [provisioningAction, setProvisioningAction] = useState<ProvisioningAction>("create_team");
  const [error, setError] = useState<string | null>(null);

  const handleBootstrap = useCallback(
    async (
      action: "join" | "create",
      input?: { kind?: "personal" | "team"; name?: string; organizationId?: string },
    ) => {
      const nextProvisioningAction: ProvisioningAction =
        action === "join" ? "join" : input?.kind === "personal" ? "create_personal" : "create_team";

      setProvisioningAction(nextProvisioningAction);
      setStep("provisioning");
      setBootstrapping(true);
      setError(null);
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
        setError(getErrorMessage(caughtError) || "Something went wrong");
        setStep(action === "join" ? "discovery" : "choice");
        setBootstrapping(false);
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

        setInvitations(pendingInvites);
        setDiscovery(result);

        if (pendingInvites.length > 0) {
          setStep("invitations");
          return;
        }

        if (result.isPublicEmail) {
          await handleBootstrap("create", { kind: "personal" });
          return;
        }

        if (result.orgs.length === 0) {
          setStep("choice");
        } else {
          setStep("discovery");
        }
      } catch (caughtError: unknown) {
        if (cancelled) {
          return;
        }

        const message = getErrorMessage(caughtError);

        if (message === "Unauthorized.") {
          void navigate("/login", { replace: true });
          return;
        }

        setError(message);
        setStep("discovery");
      }
    }

    void loadOnboarding();

    return () => {
      cancelled = true;
    };
  }, [handleBootstrap, navigate]);

  const handleAcceptInvitation = async (invitationId: string) => {
    setProvisioningAction("join");
    setStep("provisioning");
    setBootstrapping(true);
    setError(null);

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
      setError(getErrorMessage(nextError) || "Something went wrong");
      setStep("invitations");
      setBootstrapping(false);
    }
  };

  const handleRequestAccess = async (organizationId: string) => {
    setProvisioningAction("create_team");
    setStep("provisioning");
    setBootstrapping(true);
    setError(null);

    try {
      await requestOrganizationAccess(toOrganizationId(organizationId));
      await handleBootstrap("create", { kind: "team" });
    } catch (nextError: unknown) {
      setError(getErrorMessage(nextError) || "Something went wrong");
      setStep("discovery");
      setBootstrapping(false);
    }
  };

  // ── Loading state ──
  if (step === "loading") {
    return (
      <div className="bg-background fixed inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="text-primary size-8 animate-spin" />
          <p className="text-muted-foreground text-sm">Setting things up…</p>
        </div>
      </div>
    );
  }

  // ── Provisioning state ──
  if (step === "provisioning") {
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

  // ── Discovery Screen ──
  const orgs = discovery?.orgs ?? [];
  const joinableOrgs = orgs.filter((o) => o.joinPolicy === "auto");
  const inviteOnlyOrgs = orgs.filter((o) => o.joinPolicy === "invite_only");
  const domainOrganizationName = getOnboardingDomainOrganizationName(discovery?.domain);

  if (step === "invitations") {
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
                  onClick={() => void handleAcceptInvitation(invitation.id)}
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
                onClick={() =>
                  void handleBootstrap("create", {
                    kind: discovery?.isPublicEmail === true ? "personal" : "team",
                  })
                }
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

  if (step === "choice") {
    return (
      <OnboardingChoiceScreen
        bootstrapping={bootstrapping}
        domain={discovery?.domain}
        error={error}
        onCreatePersonal={() => void handleBootstrap("create", { kind: "personal" })}
        onCreateTeam={(name) => void handleBootstrap("create", { kind: "team", name })}
      />
    );
  }

  return (
    <div className="bg-background fixed inset-0 flex flex-col">
      <div className="flex items-center px-10 py-[22px]">
        <img src="/brand/logo-wordmark-onlight.svg" alt="Mosoo" className="block h-[22px]" />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[480px] px-6">
          <div className="mb-6 flex justify-center">
            <div className="bg-accent-soft border-accent-soft-hover flex size-16 items-center justify-center rounded-md border">
              <Building2 className="text-accent-press size-7" />
            </div>
          </div>

          <h2 className="text-fg-1 text-center text-[24px] font-semibold tracking-normal">
            Welcome, {user?.name?.split(" ")[0] ?? "there"}.
          </h2>
          <p className="text-muted-foreground mt-2 text-center text-sm">
            We found organizations on{" "}
            <span className="text-foreground font-medium">@{discovery?.domain}</span>
          </p>

          {/* Org list */}
          <div className="mt-8 space-y-3">
            {joinableOrgs.map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => {
                  void handleBootstrap("join", { organizationId: org.id });
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
                onClick={() => void handleRequestAccess(org.id)}
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

          {/* Create own organization */}
          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                void handleBootstrap("create", {
                  kind: "team",
                  name: domainOrganizationName,
                });
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
