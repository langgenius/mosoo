import type { ReactElement } from "react";

import { CostSection } from "./cost-section";
import { CtaBand } from "./cta-band";
import { DeploySection } from "./deploy-section";
import { FaqSection } from "./faq-section";
import { InvokeSection } from "./invoke-section";
import { RuntimeShowcase } from "./runtime-showcase";
import { SandboxSection } from "./sandbox-section";

// Everything below the hero. Split into its own chunk and loaded lazily so the
// login route's critical path only ships the hero and auth card — the marketing
// sections (and their heavier deps, e.g. the avatar set in the cost section)
// stream in as the visitor scrolls past the first viewport.
export function LandingBelowFold({ onContinue }: { onContinue: () => void }): ReactElement {
  return (
    <>
      <DeploySection />
      <RuntimeShowcase />
      <SandboxSection />
      <InvokeSection />
      <CostSection />
      <FaqSection />
      <CtaBand onContinue={onContinue} />
    </>
  );
}
