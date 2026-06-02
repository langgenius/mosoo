import { Suspense } from "react";

import { AppLoading } from "./route-guards";
import { AppRoutes } from "./route-registry";

const appLoadingFallback = <AppLoading />;

export function App() {
  return (
    <Suspense fallback={appLoadingFallback}>
      <AppRoutes />
    </Suspense>
  );
}
