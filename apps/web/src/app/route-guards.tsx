import type { ReactElement, ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { UploadRecoveryDialog } from "../features/files/upload-recovery/upload-recovery-dialog";
import { Layout } from "./app-shell";
import { useAppSession } from "./session-provider";

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

export function ProtectedRoute({ children }: RouteChildrenProps): ReactNode {
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

  return (
    <Layout>
      <UploadRecoveryDialog />
      {children}
    </Layout>
  );
}
