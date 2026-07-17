import { Outlet } from "react-router-dom";

import { AppSettingsNav } from "./app-settings-nav";

export function AppSettingsLayout() {
  return (
    <div className="flex h-full flex-col overflow-hidden md:flex-row">
      <AppSettingsNav />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
