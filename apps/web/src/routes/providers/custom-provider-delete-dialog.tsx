import type { ReactElement } from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import type { CustomProviderDeleteDialogState } from "../../domains/vendor-credential/model/provider-credentials-model";

export function CustomProviderDeleteDialog({
  onCancel,
  onConfirm,
  state,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  state: CustomProviderDeleteDialogState;
}): ReactElement {
  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove &quot;{state.label}&quot;?</DialogTitle>
          <DialogDescription>
            Removing this Custom Provider deletes its API key from secure storage. Any Agent
            currently using one of its models will need to be reconfigured before the next session.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} variant="ghost">
            Cancel
          </Button>
          <Button onClick={onConfirm} variant="destructive">
            Remove Custom Provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
