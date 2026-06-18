import { useRef } from "react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

import type { Agent } from "../../agent.types";
import { BasicsSection, EnvironmentSection, IntegrationsSection } from "./form-sections";
import type { AgentFormSectionId } from "./section-ids";
import type { AgentEditorModel } from "./use-model";

// Three-section form layout (locked on 2026-05-05):
//   1. Basics       — name, description, runtime, model, system prompt
//   2. Integrations — skills, MCP servers
//   3. Environment  — environment
// Runtime-native JSON settings live under Basics next to model selection; keep
// future runtime-specific typed fields section-scoped when they arrive.
// One renderer for every surface (Draft Configure, Live Preview, Dev): a single
// continuous scroll with dividers between sections, so the config pane looks
// identical wherever it is mounted. The earlier "stacked vs tabbed" fork wrapped
// each section in its own card on Draft only and was the root cause of the
// Quick-Start-vs-Preview style drift and the nested-card clutter.
// `highlightedSections` + `readOnly` are load-bearing for the deferred PRD-D
// Agent Versions "frozen v3 view" feature. Do not remove as dead code without
// reading docs/prd/agent-versions.md §20.B first.
export interface AgentFormViewProps {
  agent: Agent;
  focusSection?: AgentFormSectionId | null;
  highlightedSections?: ReadonlySet<AgentFormSectionId> | null;
  model: AgentEditorModel;
  readOnly?: boolean;
  showChannels?: boolean;
}

interface AgentFormViewBodyProps {
  agent: Agent;
  focusSection: AgentFormSectionId | null;
  highlightedSections: ReadonlySet<AgentFormSectionId> | null;
  model: AgentEditorModel;
  readOnly: boolean;
  showChannels: boolean;
}

// Focus and highlight props support external section navigation.
export function AgentFormView({
  agent,
  focusSection = null,
  highlightedSections = null,
  model,
  readOnly = false,
  showChannels = false,
}: AgentFormViewProps): ReactElement {
  return (
    <AgentFormBody
      agent={agent}
      focusSection={focusSection}
      highlightedSections={highlightedSections}
      model={model}
      readOnly={readOnly}
      showChannels={showChannels}
    />
  );
}

function useSectionNavigation(input: {
  focusSection: AgentFormSectionId | null;
  highlightedSections: ReadonlySet<AgentFormSectionId> | null;
}) {
  const sectionRefs = useRef<Record<AgentFormSectionId, HTMLDivElement | null>>({
    basics: null,
    environment: null,
    integrations: null,
  });
  const scrolledFocusRef = useRef<AgentFormSectionId | null>(null);

  if (input.focusSection === null) {
    scrolledFocusRef.current = null;
  }

  function setSectionRef(sectionId: AgentFormSectionId, node: HTMLDivElement | null): void {
    sectionRefs.current[sectionId] = node;

    if (
      node !== null &&
      input.focusSection === sectionId &&
      scrolledFocusRef.current !== sectionId
    ) {
      scrolledFocusRef.current = sectionId;
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const activeRings = input.highlightedSections ?? new Set<AgentFormSectionId>();

  return { activeRings, setSectionRef };
}

function AgentFormBody({
  agent,
  focusSection,
  highlightedSections,
  model,
  readOnly,
  showChannels,
}: AgentFormViewBodyProps): ReactElement {
  const { activeRings, setSectionRef } = useSectionNavigation({
    focusSection,
    highlightedSections,
  });

  return (
    <div className="space-y-0">
      <div
        className={cn(
          "scroll-mt-4 pb-5 transition-[box-shadow] duration-300",
          activeRings.has("basics") ? "shadow-[inset_3px_0_0_var(--brand)]" : null,
        )}
        ref={(node) => {
          setSectionRef("basics", node);
        }}
      >
        <BasicsSection agent={agent} model={model} readOnly={readOnly} />
      </div>

      <div
        className={cn(
          "border-border-subtle scroll-mt-4 border-t py-5 transition-[box-shadow] duration-300",
          activeRings.has("integrations") ? "shadow-[inset_3px_0_0_var(--brand)]" : null,
        )}
        ref={(node) => {
          setSectionRef("integrations", node);
        }}
      >
        <IntegrationsSection model={model} appId={agent.appId} readOnly={readOnly} />
      </div>

      <div
        className={cn(
          "border-border-subtle scroll-mt-4 border-t py-5 transition-[box-shadow] duration-300",
          activeRings.has("environment") ? "shadow-[inset_3px_0_0_var(--brand)]" : null,
        )}
        ref={(node) => {
          setSectionRef("environment", node);
        }}
      >
        <EnvironmentSection
          agent={agent}
          model={model}
          readOnly={readOnly}
          showChannels={showChannels}
        />
      </div>
    </div>
  );
}
