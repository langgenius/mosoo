import BotIcon from "@hugeicons/core-free-icons/BotIcon";
import DashboardSquare01Icon from "@hugeicons/core-free-icons/DashboardSquare01Icon";
import Files02Icon from "@hugeicons/core-free-icons/Files02Icon";
import InboxIcon from "@hugeicons/core-free-icons/InboxIcon";
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { SidebarRow, SidebarSectionLabel } from "@/shared/ui/sidebar";
import type { SidebarIcon } from "@/shared/ui/sidebar";
import {
  EnvironmentsToolIcon,
  McpServersToolIcon,
  ProvidersToolIcon,
  SkillsToolIcon,
} from "@/shared/ui/tool-icons";

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

const OverviewIcon = createHugeicon(DashboardSquare01Icon, "OverviewIcon");
const RunsIcon = createHugeicon(InboxIcon, "RunsIcon");
const AgentsIcon = createHugeicon(BotIcon, "AgentsIcon");
const FilesIcon = createHugeicon(Files02Icon, "FilesIcon");
const ProjectSettingsIcon = createHugeicon(Settings02Icon, "ProjectSettingsIcon");

// Upper area: the Project's daily work surfaces first, then the four Tools an
// Agent is assembled from, each with its own glyph so it stays recognisable in
// the icon-only rail. Lower area: project-level settings, which sit with the
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
          { icon: SkillsToolIcon, label: t("nav.skills"), path: "/integrations/skills" },
          { icon: McpServersToolIcon, label: t("nav.mcpServers"), path: "/integrations/mcp" },
          { icon: ProvidersToolIcon, label: t("nav.providers"), path: "/providers" },
          { icon: EnvironmentsToolIcon, label: t("nav.environments"), path: "/environment" },
        ],
        label: t("nav.tools"),
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
