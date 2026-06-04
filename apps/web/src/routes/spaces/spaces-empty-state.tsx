import { Folder, Plus, Search } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import type { Scope } from "@/shared/ui/scope-tabs";

export function SpacesEmptyState({
  onCreateSpace,
  scope,
  searching,
}: {
  onCreateSpace: () => void;
  scope: Scope;
  searching: boolean;
}): ReactElement {
  if (searching) {
    return (
      <EmptyState
        icon={Search}
        title="No matching spaces"
        description="Try a different search term."
      />
    );
  }

  if (scope === "shared") {
    return (
      <EmptyState
        icon={Folder}
        title="No spaces shared with you yet"
        description="Spaces shared with you by teammates will appear here."
      />
    );
  }

  if (scope === "organization") {
    return (
      <EmptyState
        icon={Folder}
        title="No organization spaces"
        description="Spaces created by anyone in this organization will appear here."
      />
    );
  }

  return (
    <EmptyState
      icon={Folder}
      title="No spaces yet"
      description="Create a Space to share files with Agents and teammates."
      action={
        <Button onClick={onCreateSpace} size="sm">
          <Plus className="size-3.5" />
          New space
        </Button>
      }
    />
  );
}
