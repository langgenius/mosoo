import { Suspense, useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

import { DocumentTitle } from "./document-title";
import { AppLoading } from "./route-guards";
import { AppRoutes, preloadRoute } from "./route-registry";

const appLoadingFallback = <AppLoading />;
const ROUTE_READY_MARK_PREFIX = "mosoo:route-ready:";
const ROUTE_PREFETCHED_MARK_PREFIX = "mosoo:route-prefetched:";

function RouteIntentPrefetcher() {
  useEffect(() => {
    const prefetchedAnchors = new WeakMap<HTMLAnchorElement, string>();
    const prefetch = (event: Event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      const url = new URL(anchor.href, globalThis.location.href);
      if (
        url.origin !== globalThis.location.origin ||
        prefetchedAnchors.get(anchor) === url.pathname
      ) {
        return;
      }
      prefetchedAnchors.set(anchor, url.pathname);
      void preloadRoute(url.pathname).then(
        () => performance.mark(`${ROUTE_PREFETCHED_MARK_PREFIX}${url.pathname}`),
        () => {
          prefetchedAnchors.delete(anchor);
        },
      );
    };

    document.addEventListener("focusin", prefetch);
    document.addEventListener("pointerover", prefetch);
    return () => {
      document.removeEventListener("focusin", prefetch);
      document.removeEventListener("pointerover", prefetch);
    };
  }, []);

  return null;
}

function RouteReadyMarker() {
  const location = useLocation();

  useLayoutEffect(() => {
    performance.mark(`${ROUTE_READY_MARK_PREFIX}${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  return null;
}

export function App() {
  return (
    <>
      <DocumentTitle />
      <RouteIntentPrefetcher />
      <Suspense fallback={appLoadingFallback}>
        <AppRoutes />
        <RouteReadyMarker />
      </Suspense>
    </>
  );
}
