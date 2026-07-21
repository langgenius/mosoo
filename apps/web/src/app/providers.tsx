import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";

import { appQueryClient } from "./query-client";
import { AppSessionProvider } from "./session-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={appQueryClient}>
      <BrowserRouter>
        <AppSessionProvider>{children}</AppSessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
