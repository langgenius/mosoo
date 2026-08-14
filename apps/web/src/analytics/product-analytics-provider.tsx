import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";

import {
  captureProductEvent,
  configureProductAnalytics,
  identifyProductUser,
  PRODUCT_ANALYTICS_EVENTS,
} from "./product-analytics";

configureProductAnalytics({
  apiHost: import.meta.env.VITE_POSTHOG_API_HOST,
  deploymentMode: import.meta.env.VITE_MOSOO_DEPLOYMENT_MODE,
  environment: import.meta.env.VITE_MOSOO_ENVIRONMENT,
  projectKey: import.meta.env.VITE_POSTHOG_PROJECT_KEY ?? "",
});

export function ProductAnalyticsProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { activeAppId, activeOrganizationId, user } = useAppSession();
  const lastPageKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (user !== null) {
      identifyProductUser({ accountId: user.id, email: user.email, name: user.name });
    }
  }, [user]);

  useEffect(() => {
    const pageKey = `${location.pathname}${location.search}`;
    if (lastPageKeyRef.current === pageKey) {
      return;
    }
    lastPageKeyRef.current = pageKey;
    captureProductEvent(PRODUCT_ANALYTICS_EVENTS.pageViewed, {
      app_id: activeAppId,
      organization_id: activeOrganizationId,
      route: location.pathname,
    });
  }, [activeAppId, activeOrganizationId, location.pathname, location.search]);

  return children;
}
