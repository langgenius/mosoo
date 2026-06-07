import type { OrganizationJoinTarget } from "@mosoo/contracts/organization";
import { ArrowRight, CheckCircle2, Clock3, Loader2, Shield } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/shared/ui/button";

import { useAppSession } from "../../app/session-provider";
import {
  acceptOrganizationInvitation,
  organizationJoinTarget,
  requestOrganizationAccess,
} from "../../domains/organization/api/organization-client";
import { isTruthy } from "../../shared/lib/truthiness";
import { toOrganizationId, toOrganizationInvitationId } from "../typed-id";
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}

type OrganizationJoinStatus = "guest" | "invite" | "member" | "missing" | "pending" | "request";

export function OrganizationJoinPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const navigate = useNavigate();
  const {
    refreshOnboardingState,
    refreshPendingInvitations,
    refreshOrganizations,
    setActiveOrganizationId,
    user,
    userLoading,
  } = useAppSession();
  const [joinState, setJoinState] = useState<{
    target: OrganizationJoinTarget | null;
    loading: boolean;
    error: string | null;
  }>({ target: null, loading: true, error: null });
  const [submitting, setSubmitting] = useState(false);

  const { target, loading, error } = joinState;

  function setError(next: string | null) {
    setJoinState((previous) => ({ ...previous, error: next }));
  }

  useEffect(() => {
    const abortController = new AbortController();

    if (!isTruthy(organizationId)) {
      setJoinState({ target: null, loading: false, error: "Organization not found." });
      return;
    }

    setJoinState((previous) => ({ ...previous, loading: true, error: null }));

    void (async () => {
      try {
        const nextTarget = await organizationJoinTarget(toOrganizationId(organizationId));
        if (!abortController.signal.aborted) {
          setJoinState({ target: nextTarget, loading: false, error: null });
        }
      } catch (nextError) {
        if (!abortController.signal.aborted) {
          setJoinState({ target: null, loading: false, error: getErrorMessage(nextError) });
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [user?.id, organizationId]);

  const status = useMemo(() => {
    if (!target) {
      return "missing";
    }

    if (!target.viewerIsAuthenticated) {
      return "guest";
    }

    if (target.viewerIsMember) {
      return "member";
    }

    if (target.pendingInvitation) {
      return "invite";
    }

    if (target.pendingRequest) {
      return "pending";
    }

    return "request";
  }, [target]);

  function handleContinueToSignIn() {
    if (!isTruthy(organizationId)) {
      return;
    }

    void navigate(`/login?redirect=${encodeURIComponent(`/join/${organizationId}`)}`);
  }

  async function handleOpenOrganization() {
    if (!target) {
      return;
    }

    await setActiveOrganizationId(target.organization.id);
    void navigate("/", { replace: true });
  }

  async function handleAcceptInvite() {
    if (!target?.pendingInvitation) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const organization = await acceptOrganizationInvitation(
        toOrganizationInvitationId(target.pendingInvitation.id),
      );
      await Promise.all([
        refreshPendingInvitations(),
        refreshOrganizations(),
        refreshOnboardingState(),
        setActiveOrganizationId(organization.id),
      ]);
      void navigate("/", { replace: true });
    } catch (nextError: unknown) {
      setError(getErrorMessage(nextError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestAccess() {
    if (!isTruthy(organizationId)) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const pendingRequest = await requestOrganizationAccess(toOrganizationId(organizationId));
      setJoinState((previous) => ({
        ...previous,
        target: previous.target ? { ...previous.target, pendingRequest } : previous.target,
      }));
    } catch (nextError: unknown) {
      setError(getErrorMessage(nextError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <OrganizationJoinLayout>
      {loading || userLoading ? (
        <OrganizationJoinLoading />
      ) : target ? (
        <OrganizationJoinTargetCard
          error={error}
          onAcceptInvite={handleAcceptInvite}
          onContinueToSignIn={handleContinueToSignIn}
          onOpenOrganization={handleOpenOrganization}
          onRequestAccess={handleRequestAccess}
          status={status}
          submitting={submitting}
          target={target}
          userEmail={user?.email ?? null}
        />
      ) : (
        <OrganizationJoinMissing />
      )}
    </OrganizationJoinLayout>
  );
}

function OrganizationJoinLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background min-h-screen">
      <div className="flex items-center px-8 py-5">
        <span className="text-xl font-light tracking-tight">Mosoo</span>
      </div>
      <div className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-10">
        <div className="border-border bg-card/80 w-full max-w-[540px] rounded-lg border p-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

function OrganizationJoinLoading() {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-4">
      <Loader2 className="text-primary size-8 animate-spin" />
      <p className="text-muted-foreground text-sm">Loading organization access…</p>
    </div>
  );
}

function OrganizationJoinMissing() {
  return (
    <div className="space-y-4">
      <h1 className="text-foreground text-xl font-semibold">Organization not found</h1>
      <p className="text-muted-foreground text-sm">
        This link may be invalid, or the organization is no longer available.
      </p>
    </div>
  );
}

function OrganizationJoinTargetCard({
  error,
  onAcceptInvite,
  onContinueToSignIn,
  onOpenOrganization,
  onRequestAccess,
  status,
  submitting,
  target,
  userEmail,
}: {
  error: string | null;
  onAcceptInvite: () => Promise<void>;
  onContinueToSignIn: () => void;
  onOpenOrganization: () => Promise<void>;
  onRequestAccess: () => Promise<void>;
  status: OrganizationJoinStatus;
  submitting: boolean;
  target: OrganizationJoinTarget;
  userEmail: string | null;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="bg-primary/10 text-primary inline-flex size-12 items-center justify-center rounded-2xl">
          <Shield className="size-6" />
        </div>
        <div>
          <h1 className="text-foreground text-2xl font-semibold">{target.organization.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">Part of {target.organizationName}</p>
        </div>
      </div>

      <div className="border-border bg-background/70 rounded-lg border p-4">
        <OrganizationJoinStatusPanel
          onAcceptInvite={onAcceptInvite}
          onContinueToSignIn={onContinueToSignIn}
          onOpenOrganization={onOpenOrganization}
          onRequestAccess={onRequestAccess}
          status={status}
          submitting={submitting}
          target={target}
        />
      </div>

      {userEmail !== null ? (
        <div className="text-muted-foreground text-xs">
          Signed in as <span className="text-foreground font-medium">{userEmail}</span>
        </div>
      ) : null}

      {isTruthy(error) ? (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-xl border px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function OrganizationJoinStatusPanel({
  onAcceptInvite,
  onContinueToSignIn,
  onOpenOrganization,
  onRequestAccess,
  status,
  submitting,
  target,
}: {
  onAcceptInvite: () => Promise<void>;
  onContinueToSignIn: () => void;
  onOpenOrganization: () => Promise<void>;
  onRequestAccess: () => Promise<void>;
  status: OrganizationJoinStatus;
  submitting: boolean;
  target: OrganizationJoinTarget;
}) {
  if (status === "guest") {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-foreground text-sm font-medium">
            Continue to sign in to this organization
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Use Google or your email code. If you were invited directly, we will pick that up after
            login.
          </p>
        </div>
        <Button onClick={onContinueToSignIn}>
          Continue
          <ArrowRight className="ml-1 size-4" />
        </Button>
      </div>
    );
  }

  if (status === "member") {
    return (
      <div className="space-y-4">
        <div className="text-success-fg flex items-center gap-2">
          <CheckCircle2 className="size-5" />
          <span className="text-sm font-medium">You already have access</span>
        </div>
        <p className="text-muted-foreground text-sm">
          Open this organization and continue where you left off.
        </p>
        <Button onClick={() => void onOpenOrganization()}>Open organization</Button>
      </div>
    );
  }

  if (status === "invite") {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-foreground text-sm font-medium">
            You have a direct invite to join this organization
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {isTruthy(target.pendingInvitation?.invitedByName)
              ? `Invited by ${target.pendingInvitation.invitedByName}.`
              : "You can accept and enter right away."}
          </p>
        </div>
        <Button onClick={() => void onAcceptInvite()} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Accepting…
            </>
          ) : (
            "Accept invite"
          )}
        </Button>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="space-y-4">
        <div className="text-amber-fg flex items-center gap-2">
          <Clock3 className="size-5" />
          <span className="text-sm font-medium">Access request pending</span>
        </div>
        <p className="text-muted-foreground text-sm">
          An admin will review your request before granting access to this organization.
        </p>
      </div>
    );
  }

  if (status === "request") {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-foreground text-sm font-medium">Request access to this organization</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Your request will be sent to the organization admins for review.
          </p>
        </div>
        <Button onClick={() => void onRequestAccess()} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Sending…
            </>
          ) : (
            "Request access"
          )}
        </Button>
      </div>
    );
  }

  return null;
}
