import type { ProjectSummary } from "@mosoo/contracts/project";

// Resolves the active Project for the Project-layer console:
// - an explicit selection wins (multi-Project switching),
// - otherwise a lone Project lands the user straight in it (single-Project / OPC),
// - otherwise null, which routes a multi-Project owner to the Org-layer Projects list.
export function resolveActiveProject(
  projects: readonly ProjectSummary[],
  selectedProjectId: string | null = null,
): ProjectSummary | null {
  if (selectedProjectId !== null) {
    const selected = projects.find((project) => project.id === selectedProjectId);

    if (selected !== undefined) {
      return selected;
    }
  }

  if (projects.length === 1) {
    const [onlyProject] = projects;
    return onlyProject ?? null;
  }

  return null;
}
