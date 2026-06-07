import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

interface DeleteSpaceDialogProps {
  confirmationName: string;
  deleting: boolean;
  name: string | undefined;
  onChangeConfirmationName: (value: string) => void;
  onDelete: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function DeleteSpaceDialog({
  confirmationName,
  deleting,
  name,
  onChangeConfirmationName,
  onDelete,
  onOpenChange,
  open,
}: DeleteSpaceDialogProps): ReactElement {
  const canDelete = name !== undefined && confirmationName === name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg sm:max-w-[380px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg">Delete space</DialogTitle>
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
