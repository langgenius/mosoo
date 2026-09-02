import { Suspense } from "react";

import { DocumentTitle } from "./document-title";
import { AppLoading } from "./route-guards";
import { AppRoutes } from "./route-registry";

const projectLoadingFallback = <AppLoading />;

export function Project() {
  return (
    <>
      <DocumentTitle />
      <Suspense fallback={projectLoadingFallback}>
        <AppRoutes />
      </Suspense>
    </>
  );
}
