import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { useAppSession } from "@/app/session/session-context";

import {
  captureProductEvent,
  configureProductAnalytics,
  identifyProductUser,
  PRODUCT_ANALYTICS_EVENTS,
} from "./product-analytics";

configureProductAnalytics(import.meta.env.VITE_POSTHOG_PROJECT_KEY ?? "");

export function ProductAnalyticsProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { activeProjectId, activeOrganizationId, user } = useAppSession();
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
      project_id: activeProjectId,
      organization_id: activeOrganizationId,
      route: location.pathname,
    });
  }, [activeProjectId, activeOrganizationId, location.pathname, location.search]);

  return children;
}
