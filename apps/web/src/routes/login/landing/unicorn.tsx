import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

// The landing page is the first thing every unauthenticated visitor loads, and
// this background is purely decorative (aria-hidden, non-interactive, behind the
// content). The actual rendering is done by the Unicorn Studio runtime fetched
// from the CDN below — we deliberately do NOT depend on `unicornstudio-react`,
// whose single module inlines the full ~1.3 MB WebGL engine. Importing that
// wrapper shipped the engine in our own bundle (a 252 KB gzip route chunk) on
// top of the CDN script, so the landing route paid for the engine twice. This
// thin wrapper drives the same CDN SDK directly via `window.UnicornStudio`, so
// the only WebGL bytes on the critical path are the ones we already loaded.
const UNICORN_SDK_URL =
  "https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.2.0/dist/unicornStudio.umd.js";

interface UnicornScene {
  destroy: () => void;
}

interface UnicornStudioSdk {
  addScene: (config: {
    element: HTMLElement;
    projectId: string;
    fps?: number;
    scale?: number;
    dpi?: number;
    lazyLoad?: boolean;
    production?: boolean;
  }) => Promise<UnicornScene>;
}

declare global {
  interface Window {
    UnicornStudio?: UnicornStudioSdk;
  }
}

// Inject the runtime SDK once and share the in-flight promise across every scene
// on the page, so the hero and CTA backgrounds load the global engine a single
// time instead of racing two identical <script> fetches.
let sdkPromise: Promise<UnicornStudioSdk> | null = null;

function loadUnicornSdk(): Promise<UnicornStudioSdk> {
  if (window.UnicornStudio) {
    return Promise.resolve(window.UnicornStudio);
  }
  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise<UnicornStudioSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = UNICORN_SDK_URL;
    script.async = true;
    script.addEventListener("load", () => {
      if (window.UnicornStudio) {
        resolve(window.UnicornStudio);
      } else {
        reject(new Error("Unicorn Studio SDK loaded without exposing a runtime"));
      }
    });
    script.addEventListener("error", () => {
      // Let a later mount retry the fetch rather than caching the failure.
      sdkPromise = null;
      reject(new Error("Failed to load the Unicorn Studio SDK"));
    });
    document.head.append(script);
  });

  return sdkPromise;
}

/**
 * Full-bleed, non-interactive WebGL scene pinned behind a section's content.
 * If the SDK or scene asset fails to load (a flaky CDN fetch), it removes
 * itself so the section's own background shows through — the copy on top stays
 * readable instead of sitting on a black canvas.
 */
export function UnicornBackground({ sceneId }: { sceneId: string }): ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (element === null) {
      return;
    }

    let cancelled = false;
    let scene: UnicornScene | null = null;

    loadUnicornSdk()
      .then(async (sdk) => sdk.addScene({ element, projectId: sceneId }))
      .then((created) => {
        if (cancelled) {
          // Unmounted before the scene resolved — tear it down immediately.
          created.destroy();
          return;
        }
        scene = created;
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
      scene?.destroy();
    };
  }, [sceneId]);

  if (failed) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0"
    />
  );
}
