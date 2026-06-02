import type { DirectoryEntry, FileEntry } from "@mosoo/contracts/space";
import type React from "react";

export interface SpaceBrowserProps {
  canWrite: boolean;
  currentPath: string;
  dirs: DirectoryEntry[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  files: FileEntry[];
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  loading: boolean;
  newFolderError: string | null;
  newFolderName: string;
  onCreateFolder: () => void;
  onDeleteDirectory: (key: string) => void;
  onDeleteFile: (fileId: string) => void;
  onDownloadFile: (fileId: string) => void;
  onOpenFile: (fileId: string) => void;
  onOpenRenameFile: (file: FileEntry) => void;
  onSetCurrentPath: (path: string) => void;
  onSetNewFolderName: (value: string) => void;
  onSetShowNewFolder: (open: boolean) => void;
  showNewFolder: boolean;
  viewMode: "list" | "grid";
}
