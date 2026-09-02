import { Suspense } from "react";

import { DocumentTitle } from "./document-title";
import { AppLoading } from "./route-guards";
import { AppRoutes } from "./route-registry";

const appLoadingFallback = <AppLoading />;

export function App() {
  return (
    <>
      <DocumentTitle />
      <Suspense fallback={appLoadingFallback}>
        <AppRoutes />
      </Suspense>
    </>
  );
}
