import type { SpaceView } from "@mosoo/contracts/space";
import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

interface RenameFileDialogProps {
  currentSpaceId: string | null;
  error: string | null;
  onChangeTargetSpaceId: (value: string) => void;
  onChangeValue: (value: string) => void;
  onClose: () => void;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
  open: boolean;
  readOnlyReason: string | null;
  renaming: boolean;
  targetSpaceId: string | null;
  targetSpaces: SpaceView[];
  value: string;
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
}: RenameFileDialogProps): ReactElement {
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
