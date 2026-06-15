import type { ReactElement } from "react";

import { CostSection } from "./cost-section";
import { CtaBand } from "./cta-band";
import { DeploySection } from "./deploy-section";
import { FaqSection } from "./faq-section";
import { Hero } from "./hero";
import { InvokeSection } from "./invoke-section";
import { RuntimeShowcase } from "./runtime-showcase";
import { SandboxSection } from "./sandbox-section";

export function LoginLanding({ onContinue }: { onContinue: () => void }): ReactElement {
  return (
    <div className="px-4 md:px-6">
      {/* A single framed column — continuous left/right hairlines run the full
          height (the "wireframe"); sections are split by horizontal dividers. */}
      <div className="border-border-strong divide-border-strong mx-auto w-full max-w-[1280px] divide-y border-x">
        <Hero onContinue={onContinue} />
        <DeploySection />
        <RuntimeShowcase />
        <SandboxSection />
        <InvokeSection />
        <CostSection />
        <FaqSection />
        <CtaBand onContinue={onContinue} />
      </div>
    </div>
  );
}
