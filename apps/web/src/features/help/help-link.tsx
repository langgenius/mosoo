import type { ReactElement } from "react";

import { MOSOO_DOCS_URL } from "@/shared/config/external-links";
import { useTranslation } from "@/shared/i18n";
import { HelpCircle } from "@/shared/ui/icons";
import { SidebarRowBody, SidebarTooltip, sidebarRowClassName } from "@/shared/ui/sidebar";

/** Sidebar row that opens the public docs in a new tab. */
export function HelpLink({ collapsed }: { collapsed: boolean }): ReactElement {
  const { t } = useTranslation();
  const label = t("help.helpAndDocs");

  return (
    <SidebarTooltip collapsed={collapsed} label={label}>
      <a
        aria-label={collapsed ? label : undefined}
        className={sidebarRowClassName({ collapsed })}
        href={MOSOO_DOCS_URL}
        rel="noreferrer"
        target="_blank"
      >
        <SidebarRowBody collapsed={collapsed} icon={HelpCircle} label={label} />
      </a>
    </SidebarTooltip>
  );
}
