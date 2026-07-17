import { Outlet } from "react-router-dom";

import { SettingsNav } from "./settings-nav";

export function SettingsLayout() {
  return (
    <div className="flex h-full flex-col overflow-hidden md:flex-row">
      <SettingsNav />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
