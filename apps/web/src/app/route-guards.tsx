import { lazy } from "react";
import type { ReactElement, ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { UploadRecoveryDialog } from "../features/files/upload-recovery/upload-recovery-dialog";
import { useAppSession } from "./session-provider";

// The authenticated app shell (sidebar navigation, account/help menus, org
// chrome) only renders once a signed-in user clears the guards below. Loading
// it lazily keeps the whole shell subtree out of the entry chunk, so the
// public /login + landing route — the cold-start page for first-time and
// logged-out visitors, where the shell never mounts — no longer pays to
// download it. Both wrappers pull the same "./app-shell" module, so they share
// one chunk and a signed-in visitor fetches it in parallel with the first route
// chunk (both are dynamic imports resolved after the same auth check).
const Layout = lazy(async () => {
  const appShell = await import("./app-shell");
  return { default: appShell.Layout };
});
const OrgLayout = lazy(async () => {
  const appShell = await import("./app-shell");
  return { default: appShell.OrgLayout };
});

interface RouteChildrenProps {
  children: ReactNode;
}

export function AppLoading(): ReactElement {
  return (
    <div className="text-muted-foreground flex h-screen items-center justify-center">Loading…</div>
  );
}

export function GuestRoute({ children }: RouteChildrenProps): ReactNode {
  const { onboardingState, user, userLoading } = useAppSession();

  if (userLoading) {
    return <AppLoading />;
  }
  if (!user) {
    return children;
  }
  if (onboardingState === "loading" || onboardingState === null) {
    return <AppLoading />;
  }

  return <Navigate to={onboardingState === "complete" ? "/" : "/onboarding"} replace />;
}

export function OnboardingRoute({ children }: RouteChildrenProps): ReactNode {
  const { onboardingState, user, userLoading } = useAppSession();

  if (userLoading) {
    return <AppLoading />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (onboardingState === "loading" || onboardingState === null) {
    return <AppLoading />;
  }

  if (onboardingState === "complete") {
    return <Navigate to="/" replace />;
  }

  return children;
}

export function ProtectedRoute({
  children,
  shell = "app",
}: RouteChildrenProps & { shell?: "app" | "org" }): ReactNode {
  const location = useLocation();
  const { onboardingState, user, userLoading } = useAppSession();
  const redirectTarget = `${location.pathname}${location.search}${location.hash}`;
  const loginPath =
    redirectTarget === "/" ? "/login" : `/login?redirect=${encodeURIComponent(redirectTarget)}`;

  if (userLoading) {
    return <AppLoading />;
  }
  if (!user) {
    return <Navigate to={loginPath} replace />;
  }
  if (onboardingState === "pending") {
    return <Navigate to="/onboarding" replace />;
  }
  if (onboardingState === "loading" || onboardingState === null) {
    return <AppLoading />;
  }

  const Shell = shell === "org" ? OrgLayout : Layout;

  return (
    <Shell>
      <UploadRecoveryDialog />
      {children}
    </Shell>
  );
}
