import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";

import { TooltipProvider } from "@/shared/ui/tooltip";

import { appQueryClient } from "./query-client";
import { AppSessionProvider } from "./session-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={appQueryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <AppSessionProvider>{children}</AppSessionProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
