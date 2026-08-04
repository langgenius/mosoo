import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";

import { ProductAnalyticsProvider } from "@/analytics/product-analytics-provider";
import { I18nProvider } from "@/shared/i18n";

import { appQueryClient } from "./query-client";
import { AppSessionProvider } from "./session-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <QueryClientProvider client={appQueryClient}>
        <BrowserRouter>
          <AppSessionProvider>
            <ProductAnalyticsProvider>{children}</ProductAnalyticsProvider>
          </AppSessionProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </I18nProvider>
  );
}
