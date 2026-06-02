import { FolderPlus } from "lucide-react";
import type { KeyboardEvent } from "react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { TableCell, TableRow } from "@/shared/ui/table";

import { isTruthy } from "../../shared/lib/truthiness";
import type { SpaceBrowserProps } from "./browser-types";
type SpaceBrowserDraftProps = Pick<
  SpaceBrowserProps,
  | "newFolderError"
  | "newFolderName"
  | "onCreateFolder"
  | "onSetNewFolderName"
  | "onSetShowNewFolder"
  | "showNewFolder"
>;

function handleDraftKeyDown({
  event,
  onCancel,
  onCreate,
}: {
  event: KeyboardEvent<HTMLInputElement>;
  onCancel: () => void;
  onCreate: () => void;
}) {
  if (event.key === "Enter") {
    onCreate();
  }

  if (event.key === "Escape") {
    onCancel();
  }
}

function FolderDraftRow({
  error,
  name,
  onChange,
  onCreate,
  onCancel,
}: {
  error: string | null;
  name: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <TableRow className="border-border-subtle/50 bg-accent/20 hover:bg-accent/20 border-b">
      <TableCell colSpan={4} className="py-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <FolderPlus className="text-primary size-4" />
            <Input
              type="text"
              value={name}
              onChange={(event) => {
                onChange(event.target.value);
              }}
              onKeyDown={(event) => {
                handleDraftKeyDown({ event, onCancel, onCreate });
              }}
              placeholder="Folder name..."
              className="h-8 max-w-sm text-sm"
            />
            <Button size="xs" onClick={onCreate} disabled={!name.trim() || Boolean(error)}>
              Create
            </Button>
            <Button size="xs" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          {isTruthy(error) ? <div className="text-destructive pl-6 text-xs">{error}</div> : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function FolderDraftCard({
  error,
  name,
  onChange,
  onCreate,
  onCancel,
}: {
  error: string | null;
  name: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="border-primary/30 bg-accent/20 flex h-[120px] w-[140px] flex-col justify-between rounded-xl border border-dashed p-3">
      <div className="space-y-2">
        <FolderPlus className="text-primary size-5" />
        <Input
          type="text"
          value={name}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            handleDraftKeyDown({ event, onCancel, onCreate });
          }}
          placeholder="Folder name..."
          className="h-8 px-2 text-xs"
        />
        {isTruthy(error) ? (
          <p className="text-destructive text-[10px] leading-tight">{error}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="xs"
          className="flex-1"
          onClick={onCreate}
          disabled={!name.trim() || Boolean(error)}
        >
          Create
        </Button>
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function SpaceBrowserTableDrafts({
  newFolderError,
  newFolderName,
  onCreateFolder,
  onSetNewFolderName,
  onSetShowNewFolder,
  showNewFolder,
}: SpaceBrowserDraftProps) {
  if (!showNewFolder) {
    return null;
  }

  return (
    <FolderDraftRow
      error={newFolderError}
      name={newFolderName}
      onChange={onSetNewFolderName}
      onCreate={onCreateFolder}
      onCancel={() => {
        onSetShowNewFolder(false);
      }}
    />
  );
}

export function SpaceBrowserGridDrafts({
  newFolderError,
  newFolderName,
  onCreateFolder,
  onSetNewFolderName,
  onSetShowNewFolder,
  showNewFolder,
}: SpaceBrowserDraftProps) {
  if (!showNewFolder) {
    return null;
  }

  return (
    <FolderDraftCard
      error={newFolderError}
      name={newFolderName}
      onChange={onSetNewFolderName}
      onCreate={onCreateFolder}
      onCancel={() => {
        onSetShowNewFolder(false);
      }}
    />
  );
}
