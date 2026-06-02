import type { SpaceView } from "@mosoo/contracts/space";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  ListPageContent,
  ListPageSearch,
  ListPageToolbar,
  ListPageToolbarSpacer,
} from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";
import { ScopeTabs } from "@/shared/ui/scope-tabs";
import type { Scope } from "@/shared/ui/scope-tabs";
import { ViewToggle } from "@/shared/ui/view-toggle";

import { filterSpaces, getSpacesForScope, groupSpacesByScope } from "./spaces-hub-model";
import { SpaceGrid, SpacesEmptyState, SpaceTable } from "./spaces-hub-views";

export function SpacesHub({
  spaces,
  userId,
  loading,
  canManageSpace,
  getManageDisabledReason,
  onSelectSpace,
  onOpenSettings,
  onCreateSpace,
}: {
  spaces: SpaceView[];
  userId: string | undefined;
  loading: boolean;
  canManageSpace: (space: SpaceView) => boolean;
  getManageDisabledReason: (space: SpaceView) => string | null;
  onSelectSpace: (spaceId: string) => void;
  onOpenSettings: (spaceId: string) => void;
  onCreateSpace: () => void;
}) {
  const [scope, setScope] = useState<Scope>("mine");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");

  const spaceScopes = useMemo(() => groupSpacesByScope(spaces, userId), [spaces, userId]);
  const showOrgScope = spaceScopes.organizationSpaces.length > 0;
  const scopeSpaces = getSpacesForScope(spaceScopes, scope);

  const filteredSpaces = useMemo(() => filterSpaces(scopeSpaces, search), [scopeSpaces, search]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Spaces"
        description="Shared folders that Agents can read from and write to."
      >
        <Button onClick={onCreateSpace} size="sm">
          <Plus className="size-3.5" />
          New space
        </Button>
      </PageHeader>

      <ListPageToolbar>
        <ScopeTabs
          value={scope}
          onChange={setScope}
          tabs={[
            { count: spaceScopes.ownedSpaces.length, label: "Mine", value: "mine" },
            { count: spaceScopes.sharedSpaces.length, label: "Shared with me", value: "shared" },
            {
              count: spaceScopes.organizationSpaces.length,
              label: "All organization",
              value: "organization",
              visible: showOrgScope,
            },
          ]}
        />

        <ListPageToolbarSpacer />

        <ListPageSearch value={search} onChange={setSearch} placeholder="Search spaces…" />

        <ViewToggle value={view} onChange={setView} />
      </ListPageToolbar>

      <ListPageContent>
        {loading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">Loading spaces…</div>
        ) : filteredSpaces.length === 0 ? (
          <SpacesEmptyState
            scope={scope}
            searching={search.trim().length > 0}
            onCreateSpace={onCreateSpace}
          />
        ) : view === "list" ? (
          <SpaceTable
            spaces={filteredSpaces}
            canManageSpace={canManageSpace}
            getManageDisabledReason={getManageDisabledReason}
            onSelectSpace={onSelectSpace}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <SpaceGrid
            spaces={filteredSpaces}
            canManageSpace={canManageSpace}
            getManageDisabledReason={getManageDisabledReason}
            onSelectSpace={onSelectSpace}
            onOpenSettings={onOpenSettings}
          />
        )}
      </ListPageContent>
    </div>
  );
}
