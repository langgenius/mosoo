import { SPACE_NAME_MAX_LENGTH, SPACE_NAME_RULE_DESCRIPTION } from "@mosoo/contracts/space";
import type { SpaceView } from "@mosoo/contracts/space";
import type { CSSProperties, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

const TITLE_LETTER_SPACING_STYLE: CSSProperties = { letterSpacing: "-0.3px" };

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
}: {
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
}): ReactElement {
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

export function RenameFileDialog({
  currentSpaceId,
  error,
  onChangeValue,
  onChangeTargetSpaceId,
  onClose,
  onOpenChange,
  onRename,
  open,
  readOnlyReason,
  renaming,
  targetSpaceId,
  targetSpaces,
  value,
}: {
  currentSpaceId: string | null;
  error: string | null;
  onChangeValue: (value: string) => void;
  onChangeTargetSpaceId: (value: string) => void;
  onClose: () => void;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
  open: boolean;
  readOnlyReason: string | null;
  renaming: boolean;
  targetSpaceId: string | null;
  targetSpaces: SpaceView[];
  value: string;
}): ReactElement {
  const movingAcrossSpaces = targetSpaceId !== null && targetSpaceId !== currentSpaceId;
  const readOnly = readOnlyReason !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg sm:max-w-[420px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Rename or Move File</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {targetSpaces.length > 1 ? (
            <label className="text-foreground block text-sm font-medium">
              Destination Space
              <select
                aria-label="Destination Space"
                value={targetSpaceId ?? currentSpaceId ?? ""}
                onChange={(event) => {
                  onChangeTargetSpaceId(event.target.value);
                }}
                className="border-border bg-background focus:border-primary mt-1.5 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                disabled={renaming || readOnly}
              >
                {targetSpaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-foreground block text-sm font-medium">
            {movingAcrossSpaces ? "Destination path" : "File name"}
            <input
              aria-label={movingAcrossSpaces ? "Destination path" : "File name"}
              type="text"
              value={value}
              onChange={(event) => {
                onChangeValue(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onRename();
                }
              }}
              className="border-border bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none"
              placeholder={movingAcrossSpaces ? "folder/file.md" : "New file name"}
              readOnly={readOnly}
            />
          </label>
          {readOnlyReason !== null ? (
            <div className="text-muted-foreground text-sm">{readOnlyReason}</div>
          ) : null}
          {error !== null ? <div className="text-destructive text-sm">{error}</div> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={renaming}>
              Cancel
            </Button>
            <Button
              onClick={onRename}
              disabled={renaming || readOnly || !value.trim() || Boolean(error)}
            >
              {renaming ? "Renaming..." : "Rename"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteSpaceDialog({
  confirmationName,
  deleting,
  name,
  onChangeConfirmationName,
  onDelete,
  onOpenChange,
  open,
}: {
  confirmationName: string;
  deleting: boolean;
  name: string | undefined;
  onChangeConfirmationName: (value: string) => void;
  onDelete: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}): ReactElement {
  const canDelete = name !== undefined && confirmationName === name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg sm:max-w-[380px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg">Delete Space</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Are you sure you want to delete <strong className="break-all">{name}</strong>? This will
          permanently remove all files and detach it from any agent manifests that reference it.
        </p>
        <label className="text-foreground block text-sm font-medium">
          Type the Space name to confirm
          <input
            aria-label="Confirm Space name"
            type="text"
            value={confirmationName}
            onChange={(event) => {
              onChangeConfirmationName(event.target.value);
            }}
            className="border-border bg-background focus:border-primary mt-1.5 w-full rounded-md border px-3 py-2 text-sm outline-none"
            placeholder={name}
            disabled={deleting}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={onDelete} disabled={deleting || !canDelete}>
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
