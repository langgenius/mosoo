import { can } from "@mosoo/contracts/permission";
import type { Permission } from "@mosoo/contracts/permission";
import { BarChart3 } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";

import { UploadRecoveryDialog } from "../features/files/upload-recovery/upload-recovery-dialog";
import { Layout } from "./app-shell";
import { useAppSession } from "./session-provider";

interface RouteChildrenProps {
  children: ReactNode;
}

interface OrganizationPermissionRouteProps extends RouteChildrenProps {
  actionHref?: string;
  actionLabel?: string;
  description?: string;
  permission: Permission;
  title?: string;
}

export function AppLoading(): ReactElement {
  return (
    <div className="text-muted-foreground flex h-screen items-center justify-center">Loading…</div>
  );
}

export function GuestRoute({ children }: RouteChildrenProps): ReactNode {
  const { onboardingState, pendingInvitations, pendingInvitationsLoading, user, userLoading } =
    useAppSession();

  if (userLoading) {
    return <AppLoading />;
  }
  if (!user) {
    return children;
  }
  if (pendingInvitationsLoading || onboardingState === "loading" || onboardingState === null) {
    return <AppLoading />;
  }

  if (onboardingState !== "complete" && pendingInvitations.length > 0) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Navigate to={onboardingState === "complete" ? "/" : "/onboarding"} replace />;
}

export function OnboardingRoute({ children }: RouteChildrenProps): ReactNode {
  const { onboardingState, pendingInvitations, pendingInvitationsLoading, user, userLoading } =
    useAppSession();

  if (userLoading) {
    return <AppLoading />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (pendingInvitationsLoading || onboardingState === "loading" || onboardingState === null) {
    return <AppLoading />;
  }

  if (onboardingState === "complete" && pendingInvitations.length === 0) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export function ProtectedRoute({ children }: RouteChildrenProps): ReactNode {
  const location = useLocation();
  const { onboardingState, pendingInvitationsLoading, user, userLoading } = useAppSession();
  const redirectTarget = `${location.pathname}${location.search}${location.hash}`;
  const loginPath =
    redirectTarget === "/" ? "/login" : `/login?redirect=${encodeURIComponent(redirectTarget)}`;

  if (userLoading) {
    return <AppLoading />;
  }
  if (!user) {
    return <Navigate to={loginPath} replace />;
  }
  if (pendingInvitationsLoading) {
    return <AppLoading />;
  }
  if (onboardingState === "pending") {
    return <Navigate to="/onboarding" replace />;
  }
  if (onboardingState === "loading" || onboardingState === null) {
    return <AppLoading />;
  }

  return (
    <Layout>
      <UploadRecoveryDialog />
      {children}
    </Layout>
  );
}

export function OrganizationPermissionRoute({
  actionHref = "/settings/usage",
  actionLabel = "Open Settings Usage",
  children,
  description = "This page is available to organization admins.",
  permission,
  title = "Admins only",
}: OrganizationPermissionRouteProps): ReactNode {
  const { activeOrganization, organizationsLoading } = useAppSession();

  if (organizationsLoading) {
    return <AppLoading />;
  }

  if (!activeOrganization || !can(activeOrganization.viewerRole, permission)) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="bg-muted text-muted-foreground mb-3 flex size-10 items-center justify-center rounded-lg">
          <BarChart3 className="size-5" />
        </div>
        <h1 className="text-foreground text-lg font-semibold">{title}</h1>
        <p className="text-muted-foreground mt-2 max-w-md text-sm">{description}</p>
        <Link
          to={actionHref}
          className="border-border hover:bg-muted mt-4 rounded-md border px-3 py-2 text-sm font-semibold"
        >
          {actionLabel}
        </Link>
      </div>
    );
  }

  return children;
}
