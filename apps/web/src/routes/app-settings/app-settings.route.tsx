import { Outlet } from "react-router-dom";

import { AppSettingsNav } from "./app-settings-nav";

export function AppSettingsLayout() {
  return (
    <div className="flex h-full overflow-hidden">
      <AppSettingsNav />
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
