import { Folder, Plus, Search } from "lucide-react";
import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";

export function SpacesEmptyState({
  onCreateSpace,
  searching,
}: {
  onCreateSpace: () => void;
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

  return (
    <EmptyState
      icon={Folder}
      title="No spaces yet"
      description="Create a Space to share files with Agents in this App."
      action={
        <Button onClick={onCreateSpace} size="sm">
          <Plus className="size-3.5" />
          New space
        </Button>
      }
    />
  );
}
