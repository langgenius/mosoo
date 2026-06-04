import { SPACE_NAME_MAX_LENGTH, SPACE_NAME_RULE_DESCRIPTION } from "@mosoo/contracts/space";
import type { CSSProperties, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

const TITLE_LETTER_SPACING_STYLE: CSSProperties = { letterSpacing: "-0.3px" };

interface NewSpaceDialogProps {
  creating: boolean;
  error: string | null;
  name: string;
  onChangeName: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
  onOpenChange: (open: boolean) => void;
  onSelectVisibility: (visibility: "shared" | "private") => void;
  open: boolean;
  visibility: "shared" | "private";
}

export function NewSpaceDialog({
  creating,
  error,
  name,
  onChangeName,
  onClose,
  onCreate,
  onOpenChange,
  onSelectVisibility,
  open,
  visibility,
}: NewSpaceDialogProps): ReactElement {
  const nameLength = name.length;
  const nameIsEmpty = name.trim().length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg sm:max-w-[400px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg font-light" style={TITLE_LETTER_SPACING_STYLE}>
            New Space
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <label className="text-foreground text-sm font-medium" htmlFor="new-space-name">
              Name
            </label>
            <input
              aria-label="Space name"
              id="new-space-name"
              type="text"
              value={name}
              onChange={(event) => {
                onChangeName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onCreate();
                }
              }}
              placeholder="e.g. marketing, design-system, ops"
              maxLength={SPACE_NAME_MAX_LENGTH}
              className="border-border focus:ring-primary/40 mt-1.5 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
              <span className={error !== null ? "text-destructive" : "text-muted-foreground"}>
                {error ?? SPACE_NAME_RULE_DESCRIPTION}
              </span>
              <span className="text-muted-foreground">
                {nameLength}/{SPACE_NAME_MAX_LENGTH}
              </span>
            </div>
          </div>

          <div>
            <div className="text-foreground text-sm font-medium">Visibility</div>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  onSelectVisibility("shared");
                }}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  visibility === "shared"
                    ? "border-primary bg-primary/[0.06] text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/20",
                )}
              >
                <div className="font-medium">Shared</div>
                <div className="mt-0.5 text-xs opacity-70">Everyone can read</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectVisibility("private");
                }}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  visibility === "private"
                    ? "border-primary bg-primary/[0.06] text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/20",
                )}
              >
                <div className="font-medium">Private</div>
                <div className="mt-0.5 text-xs opacity-70">Only you</div>
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onCreate} disabled={nameIsEmpty || creating || error !== null}>
              {creating ? "Creating..." : "Create Space"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
