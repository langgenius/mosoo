import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { SidebarRow, SidebarSectionLabel } from "@/shared/ui/sidebar";
import type { SidebarIcon } from "@/shared/ui/sidebar";
import {
  AgentsIcon,
  EnvironmentsIcon,
  FilesIcon,
  McpServersIcon,
  OverviewIcon,
  ProvidersIcon,
  RunsIcon,
  SkillsIcon,
} from "@/shared/ui/sidebar-icons";

import { createHugeicon } from "./hugeicon";

interface ProjectNavItem {
  icon: SidebarIcon;
  label: string;
  path: string;
}

interface ProjectNavSection {
  items: ProjectNavItem[];
  label?: string;
}

/** `work` is the upper, scrolling area; `persistent` is the anchored footer. */
export type ProjectNavZone = "persistent" | "work";

const ProjectSettingsIcon = createHugeicon(Settings02Icon, "ProjectSettingsIcon");

// Upper area: the Project's daily work surfaces first, then the four Project
// resources an Agent is assembled from. All eight rows use the sidebar glyph
// family so the list reads as one product and stays recognisable in the rail. Lower area: project-level settings, which sit with the
// other infrequent, persistent entry points instead of interrupting the work list.
function useProjectNavSections(): Record<ProjectNavZone, ProjectNavSection[]> {
  const { t } = useTranslation();

  return {
    work: [
      {
        items: [
          { icon: OverviewIcon, label: t("nav.overview"), path: "/" },
          { icon: RunsIcon, label: t("nav.runs"), path: "/threads" },
          { icon: AgentsIcon, label: t("nav.agents"), path: "/agent" },
          { icon: FilesIcon, label: t("nav.files"), path: "/files" },
        ],
      },
      {
        items: [
          { icon: SkillsIcon, label: t("nav.skills"), path: "/integrations/skills" },
          { icon: McpServersIcon, label: t("nav.mcpServers"), path: "/integrations/mcp" },
          { icon: ProvidersIcon, label: t("nav.providers"), path: "/providers" },
          { icon: EnvironmentsIcon, label: t("nav.environments"), path: "/environment" },
        ],
        label: t("nav.resources"),
      },
    ],
    persistent: [
      {
        items: [{ icon: ProjectSettingsIcon, label: t("nav.settings"), path: "/project-settings" }],
      },
    ],
  };
}

function isNavItemActive(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function ProjectNavigation({
  collapsed,
  pathname,
  zone = "work",
}: {
  collapsed: boolean;
  pathname: string;
  zone?: ProjectNavZone;
}): ReactElement {
  const sections = useProjectNavSections()[zone];

  return (
    <div className="flex flex-col">
      {sections.map((section, index) => (
        <div key={section.label ?? `section-${index}`} className="flex flex-col gap-0.5">
          {section.label === undefined ? null : (
            <SidebarSectionLabel collapsed={collapsed}>{section.label}</SidebarSectionLabel>
          )}
          {section.items.map((item) => (
            <SidebarRow
              key={item.path}
              active={isNavItemActive(pathname, item.path)}
              collapsed={collapsed}
              icon={item.icon}
              label={item.label}
              to={item.path}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
