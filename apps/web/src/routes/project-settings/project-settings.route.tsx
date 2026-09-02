import { Outlet } from "react-router-dom";

import { ProjectSettingsNav } from "./project-settings-nav";

export function ProjectSettingsLayout() {
  return (
    <div className="flex h-full flex-col overflow-hidden md:flex-row">
      <ProjectSettingsNav />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
