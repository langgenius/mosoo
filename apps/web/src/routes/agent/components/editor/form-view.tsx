import { useRef } from "react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";

import type { Agent } from "../../agent.types";
import { BasicsSection, EnvironmentSection, IntegrationsSection } from "./form-sections";
import type { AgentFormSectionId } from "./section-ids";
import type { AgentEditorModel } from "./use-model";

// Three-section form layout (locked with Evan 2026-05-05):
//   1. Basics       — name, description, runtime, model, system prompt, AGENTS.md
//   2. Integrations — skills, MCP servers
//   3. Environment  — environment, spaces
// "Advanced Settings" was removed; runtime-specific options will return as
// Section-scoped inputs once any runtime declares them.
// `highlightedSections` + `readOnly` are load-bearing for the deferred PRD-D
// Agent Versions "frozen v3 view" feature. Do not remove as dead code without
// reading dev/prd/agent-versions.md §20.B first.
export interface AgentFormViewProps {
  agent: Agent;
  focusSection?: AgentFormSectionId | null;
  highlightedSections?: ReadonlySet<AgentFormSectionId> | null;
  mode?: "tabbed" | "stacked";
  model: AgentEditorModel;
  organizationId: string | null;
  readOnly?: boolean;
}

interface StackedAgentFormViewProps {
  agent: Agent;
  focusSection: AgentFormSectionId | null;
  highlightedSections: ReadonlySet<AgentFormSectionId> | null;
  model: AgentEditorModel;
  organizationId: string | null;
  readOnly: boolean;
}

interface StackedAgentFormSection {
  id: AgentFormSectionId;
  label: string;
  render: () => ReactNode;
}

// Tabbed mode keeps one continuous scroll with dividers between sections.
// Stacked mode renders lifecycle Configure as section cards.
// Focus and highlight props support external section navigation.
export function AgentFormView({
  agent,
  focusSection = null,
  highlightedSections = null,
  mode = "tabbed",
  model,
  organizationId,
  readOnly = false,
}: AgentFormViewProps): ReactElement {
  if (mode === "stacked") {
    return (
      <StackedAgentFormView
        agent={agent}
        focusSection={focusSection}
        highlightedSections={highlightedSections}
        model={model}
        organizationId={organizationId}
        readOnly={readOnly}
      />
    );
  }

  return (
    <TabbedAgentFormView
      agent={agent}
      focusSection={focusSection}
      highlightedSections={highlightedSections}
      model={model}
      organizationId={organizationId}
      readOnly={readOnly}
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

function TabbedAgentFormView({
  agent,
  focusSection,
  highlightedSections,
  model,
  organizationId,
  readOnly,
}: StackedAgentFormViewProps): ReactElement {
  const { activeRings, setSectionRef } = useSectionNavigation({
    focusSection,
    highlightedSections,
  });

  return (
    <div className="space-y-0">
      <div
        className={cn(
          "scroll-mt-4 py-5 transition-[box-shadow] duration-300",
          activeRings.has("basics") ? "shadow-[inset_3px_0_0_var(--brand)]" : null,
        )}
        ref={(node) => {
          setSectionRef("basics", node);
        }}
      >
        <BasicsSection
          agent={agent}
          model={model}
          organizationId={organizationId}
          readOnly={readOnly}
        />
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
        <IntegrationsSection model={model} organizationId={organizationId} readOnly={readOnly} />
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
          organizationId={organizationId}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

function StackedAgentFormView({
  agent,
  focusSection,
  highlightedSections,
  model,
  organizationId,
  readOnly,
}: StackedAgentFormViewProps): ReactElement {
  const { activeRings, setSectionRef } = useSectionNavigation({
    focusSection,
    highlightedSections,
  });

  const sections: StackedAgentFormSection[] = [
    {
      id: "basics",
      label: "Basics",
      render: () => (
        <BasicsSection
          agent={agent}
          model={model}
          organizationId={organizationId}
          readOnly={readOnly}
        />
      ),
    },
    {
      id: "integrations",
      label: "Integrations",
      render: () => (
        <IntegrationsSection model={model} organizationId={organizationId} readOnly={readOnly} />
      ),
    },
    {
      id: "environment",
      label: "Environment",
      render: () => (
        <EnvironmentSection
          agent={agent}
          model={model}
          organizationId={organizationId}
          readOnly={readOnly}
        />
      ),
    },
  ];

  return (
    <div className="space-y-3 px-1 py-3">
      {sections.map((section) => (
        <div
          className={cn(
            "scroll-mt-2 rounded-xl border bg-white px-4 transition-[box-shadow,border-color] duration-300",
            activeRings.has(section.id)
              ? "border-brand shadow-[0_0_0_3px_var(--brand-light)]"
              : "border-border-subtle",
          )}
          key={section.id}
          ref={(node) => {
            setSectionRef(section.id, node);
          }}
        >
          <div className="border-border-subtle/60 text-fg-3 border-b py-2 text-[11.5px] font-semibold tracking-wide uppercase">
            {section.label}
          </div>
          <div className="py-4">{section.render()}</div>
        </div>
      ))}
    </div>
  );
}
