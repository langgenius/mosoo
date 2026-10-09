import { lazy } from "react";
import type { ReactElement, ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";

import { useAppSession } from "./session/session-context";

// The authenticated app shell (sidebar navigation, account/help menus, org
// chrome) only renders once a signed-in user clears the guards below. Loading
// it lazily keeps the whole shell subtree out of the entry chunk, so the
// public /login route — the cold-start page for first-time and
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
  const { t } = useTranslation();
  return (
    <div className="text-fg-3 flex h-dvh items-center justify-center">{t("common.loading")}</div>
  );
}

export function GuestRoute({ children }: RouteChildrenProps): ReactNode {
  const { hasOrganization, user } = useAppSession();

  if (!user) {
    return children;
  }

  return <Navigate to={hasOrganization ? "/" : "/onboarding"} replace />;
}

export function OnboardingRoute({ children }: RouteChildrenProps): ReactNode {
  const { hasOrganization, user, userLoading } = useAppSession();

  if (userLoading) {
    return <AppLoading />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (hasOrganization) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export function ProtectedRoute({
  children,
  shell = "project",
}: RouteChildrenProps & { shell?: "project" | "org" }): ReactNode {
  const location = useLocation();
  const { hasOrganization, user, userLoading } = useAppSession();
  const redirectTarget = `${location.pathname}${location.search}${location.hash}`;
  const loginPath =
    redirectTarget === "/" ? "/login" : `/login?redirect=${encodeURIComponent(redirectTarget)}`;

  if (userLoading) {
    return <AppLoading />;
  }
  if (!user) {
    return <Navigate to={loginPath} replace />;
  }
  if (!hasOrganization) {
    return <Navigate to="/onboarding" replace />;
  }

  const Shell = shell === "org" ? OrgLayout : Layout;

  return <Shell>{children}</Shell>;
}
