import { useState } from "react";
import type { ReactElement } from "react";
import { UnicornScene } from "unicornstudio-react";

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
      <UnicornScene
        projectId={sceneId}
        sdkUrl={UNICORN_SDK_URL}
        width="100%"
        height="100%"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
