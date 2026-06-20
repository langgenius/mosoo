import { lazy, Suspense, useState } from "react";
import type { ReactElement } from "react";

// `unicornstudio-react` bundles the full ~1.3 MB WebGL engine. The landing page
// is the first thing every unauthenticated visitor loads, and this background is
// purely decorative (aria-hidden, non-interactive, behind the content). Loading
// it lazily keeps the engine out of the login route's critical path: the form and
// copy paint immediately and the aurora streams in once its chunk arrives. The
// runtime SDK is fetched separately from the CDN below, so deferring the wrapper
// costs nothing visually.
const UnicornScene = lazy(async () => {
  const mod = await import("unicornstudio-react");
  return { default: mod.UnicornScene };
});

// Shared Unicorn Studio WebGL background. A single SDK version is used across the
// whole landing so the global runtime loads once and every scene renders on the
// same build (the loader injects the SDK only on first mount).
const UNICORN_SDK_URL =
  "https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v2.2.0/dist/unicornStudio.umd.js";

/**
 * Full-bleed, non-interactive WebGL scene pinned behind a section's content.
 * If the SDK or scene asset fails to load (a flaky CDN fetch), it removes
 * itself so the section's own background shows through — the copy on top stays
 * readable instead of sitting on a black canvas.
 */
export function UnicornBackground({ sceneId }: { sceneId: string }): ReactElement | null {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 [&>div]:!h-full [&>div]:!w-full"
    >
      <Suspense fallback={null}>
        <UnicornScene
          projectId={sceneId}
          sdkUrl={UNICORN_SDK_URL}
          width="100%"
          height="100%"
          onError={() => setFailed(true)}
        />
      </Suspense>
    </div>
  );
}
