import { useSearchParams } from "react-router-dom";

import { useAppSession } from "../../app/session-provider";
import { MembersTab } from "./members-tab";

export function MembersPage() {
  const { activeOrganization: organization, organizationsLoading, user } = useAppSession();
  const [searchParams] = useSearchParams();
  const focusedMemberId = searchParams.get("member");

  if (!organization) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {organizationsLoading ? "Loading organization..." : "No organization available."}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <MembersTab
        currentUserId={user?.id ?? ""}
        focusedMemberId={focusedMemberId}
        organization={organization}
      />
    </div>
  );
}
