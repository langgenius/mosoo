import { lazy, Suspense } from "react";
import type { ReactElement } from "react";

import { Hero } from "./hero";

// The marketing sections below the hero are not part of the first viewport, so
// they load as a separate chunk once the route has painted. Keeping them out of
// the login route's initial bundle shrinks the first thing every unauthenticated
// visitor downloads.
const LandingBelowFold = lazy(async () => {
  const mod = await import("./landing-below-fold");
  return { default: mod.LandingBelowFold };
});

export function LoginLanding({ onContinue }: { onContinue: () => void }): ReactElement {
  return (
    <div className="px-4 md:px-6">
      {/* A single framed column — continuous left/right hairlines run the full
          height (the "wireframe"); sections are split by horizontal dividers. */}
      <div className="border-border-strong divide-border-strong mx-auto w-full max-w-[1280px] divide-y border-x">
        <Hero onContinue={onContinue} />
        <Suspense fallback={null}>
          <LandingBelowFold onContinue={onContinue} />
        </Suspense>
      </div>
    </div>
  );
}
