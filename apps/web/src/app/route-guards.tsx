import { use } from "react";
import type { ReactElement, ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";

import { UploadRecoveryDialog } from "../features/files/upload-recovery/upload-recovery-dialog";
import type * as AppShell from "./app-shell";
import { useAppSession } from "./session-provider";

// The authenticated app shell (sidebar navigation, account/help menus, org
// chrome) only renders once a signed-in user clears the guards below. Loading
// it lazily keeps the whole shell subtree out of the entry chunk, so the
// public /login route — the cold-start page for first-time and
// logged-out visitors, where the shell never mounts — no longer pays to
// download it. Both wrappers share one cached "./app-shell" import, so switching
// between the App and Org layouts never suspends again after either shell loads.
type AppShellModule = typeof AppShell;

let loadedAppShell: AppShellModule | undefined;
let appShellPromise: Promise<AppShellModule> | undefined;

function loadAppShell(): Promise<AppShellModule> {
  appShellPromise ??= import("./app-shell").then((appShell) => {
    loadedAppShell = appShell;
    return appShell;
  });
  return appShellPromise;
}

function Layout({ children }: RouteChildrenProps): ReactElement {
  const appShell = loadedAppShell ?? use(loadAppShell());
  const AppLayout = appShell.Layout;
  return <AppLayout>{children}</AppLayout>;
}

function OrgLayout({ children }: RouteChildrenProps): ReactElement {
  const appShell = loadedAppShell ?? use(loadAppShell());
  const OrganizationLayout = appShell.OrgLayout;
  return <OrganizationLayout>{children}</OrganizationLayout>;
}

interface RouteChildrenProps {
  children: ReactNode;
}

export function AppLoading(): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="text-muted-foreground flex h-dvh items-center justify-center">
      {t("common.loading")}
    </div>
  );
}

export function GuestRoute({ children }: RouteChildrenProps): ReactNode {
  const { onboardingState, user, userLoading } = useAppSession();

  if (!user) {
    return children;
  }
  if (userLoading) {
    return <AppLoading />;
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
  shell = "project",
}: RouteChildrenProps & { shell?: "project" | "org" }): ReactNode {
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
