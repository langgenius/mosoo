import { Check, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { WheelEvent } from "react";

import { useSpacesQuery } from "@/domains/space/query/space-queries";
import { cn } from "@/shared/lib/class-names";

import type { SpaceBinding } from "../../agent.types";

const EMPTY_SPACES: SpaceBinding[] = [];

function forwardWheelToEditorScroll(event: WheelEvent<HTMLElement>): void {
  const editorScroll = event.currentTarget.closest<HTMLElement>("[data-agent-editor-scroll]");
  const scrollTarget = editorScroll ?? document.scrollingElement;

  scrollTarget?.scrollBy({
    left: event.deltaX,
    top: event.deltaY,
  });
}

export function AgentSpacesField({
  readOnly = false,
  selectedSpaces,
  setSpaces,
  organizationId,
}: {
  readOnly?: boolean;
  selectedSpaces: SpaceBinding[];
  setSpaces: (spaces: SpaceBinding[]) => void;
  organizationId: string | null;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const spacesQuery = useSpacesQuery(organizationId);
  const availableSpaces = spacesQuery.data ?? EMPTY_SPACES;
  const hasOrganization = organizationId !== null && organizationId !== "";
  const triggerDisabled = readOnly || !hasOrganization;
  const resolvedSelectedSpaces = useMemo(
    () =>
      selectedSpaces.map((space) => {
        const resolved = availableSpaces.find((candidate) => candidate.id === space.id);

        if (!resolved) {
          return space;
        }

        return {
          id: resolved.id,
          name: resolved.name,
        };
      }),
    [availableSpaces, selectedSpaces],
  );

  function toggleSpace(space: SpaceBinding): void {
    const exists = selectedSpaces.some((current) => current.id === space.id);
    setSpaces(
      exists
        ? selectedSpaces.filter((current) => current.id !== space.id)
        : [...selectedSpaces, space],
    );
  }

  function toggleMenu(): void {
    if (triggerDisabled) {
      return;
    }

    setOpen((current) => !current);
  }

  return (
    <div className="relative">
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex min-h-[38px] w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-[13px] transition-colors",
          triggerDisabled ? "cursor-default opacity-80" : "cursor-pointer hover:border-brand/30",
          open ? "border-brand/30 ring-2 ring-brand-ring" : null,
        )}
        disabled={triggerDisabled}
        onClick={toggleMenu}
        type="button"
      >
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {resolvedSelectedSpaces.length === 0 ? (
            <span className="text-muted-foreground/50">Select spaces…</span>
          ) : (
            resolvedSelectedSpaces.map((space) => (
              <span
                className="bg-ink-100 text-fg-1 inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium"
                key={space.id}
              >
                {space.name}
              </span>
            ))
          )}
        </div>
      </button>

      {open ? (
        <>
          <button
            aria-label="Close spaces menu"
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false);
            }}
            onWheel={forwardWheelToEditorScroll}
            type="button"
          />
          <div className="border-border absolute top-full right-0 left-0 z-50 mt-1 rounded-lg border bg-white p-1.5 shadow-lg">
            <div className="max-h-[220px] overflow-y-auto" id={listboxId}>
              <SpacesMenuContent
                availableSpaces={availableSpaces}
                error={spacesQuery.error}
                loading={spacesQuery.isLoading}
                onToggle={toggleSpace}
                selectedSpaces={selectedSpaces}
              />
            </div>
            <div className="border-border-subtle mt-1 border-t pt-1">
              <a
                className="text-brand hover:bg-brand-light/60 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors"
                href="/space"
                onClick={() => {
                  setOpen(false);
                }}
              >
                <Plus className="size-4" />
                Create new Space
              </a>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function SpacesMenuContent({
  availableSpaces,
  error,
  loading,
  onToggle,
  selectedSpaces,
}: {
  availableSpaces: SpaceBinding[];
  error: unknown;
  loading: boolean;
  onToggle(space: SpaceBinding): void;
  selectedSpaces: SpaceBinding[];
}): ReactElement {
  if (loading) {
    return <div className="text-muted-foreground p-3 text-[12px]">Loading spaces…</div>;
  }

  if (error) {
    return (
      <div className="text-destructive p-3 text-[12px]">
        {error instanceof Error ? error.message : "Failed to load spaces."}
      </div>
    );
  }

  if (availableSpaces.length === 0) {
    return (
      <div className="text-muted-foreground p-3 text-[12px]">
        No spaces are available in this organization.
      </div>
    );
  }

  return (
    <>
      {availableSpaces.map((space) => {
        const selected = selectedSpaces.some((candidate) => candidate.id === space.id);

        return (
          <button
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
              selected ? "bg-ink-100 font-medium text-fg-1" : "hover:bg-accent/50",
            )}
            key={space.id}
            onClick={() => {
              onToggle({
                id: space.id,
                name: space.name,
              });
            }}
            aria-pressed={selected}
            type="button"
          >
            <div
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded border",
                selected ? "border-brand bg-brand" : "border-border",
              )}
            >
              {selected ? <Check className="size-3 text-white" /> : null}
            </div>
            {space.name}
          </button>
        );
      })}
    </>
  );
}
