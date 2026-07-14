import { createZipArchive, normalizeSkillEntries } from "@mosoo/skill-package";

// Mirrors the server-side upload limits in apps/api skill-package.shared.ts so
// oversized folders fail fast in the dialog instead of after a full upload.
const MAX_FOLDER_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_FOLDER_TOTAL_BYTES = 25 * 1024 * 1024;

const IGNORED_DIRECTORY_SEGMENTS = new Set([".git", "__MACOSX", "node_modules"]);
const IGNORED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db"]);

export interface SkillFolderFile {
  file: File;
  path: string;
}

export interface SkillFolderSelection {
  files: SkillFolderFile[];
  folderName: string;
}

export function readFolderInputSelection(files: FileList | null): SkillFolderSelection | null {
  if (!files || files.length === 0) {
    return null;
  }

  const folderFiles = Array.from(files, (file) => ({
    file,
    path: file.webkitRelativePath.length > 0 ? file.webkitRelativePath : file.name,
  }));
  const [firstSegment] = folderFiles[0]!.path.split("/");

  return {
    files: folderFiles,
    folderName: firstSegment !== undefined && firstSegment.length > 0 ? firstSegment : "skill",
  };
}

export async function readDroppedFolderSelection(
  directory: FileSystemDirectoryEntry,
): Promise<SkillFolderSelection> {
  const files: SkillFolderFile[] = [];
  await collectDirectoryFiles(directory, directory.name, files);

  return { files, folderName: directory.name };
}

export async function createSkillFolderArchiveFile(selection: SkillFolderSelection): Promise<File> {
  const admitted = selection.files.filter((entry) => !isIgnoredFolderPath(entry.path));
  let totalBytes = 0;

  for (const { file, path } of admitted) {
    if (file.size > MAX_FOLDER_ENTRY_BYTES) {
      throw new Error(
        `File exceeds the ${formatMegabytes(MAX_FOLDER_ENTRY_BYTES)} MB limit: ${path}`,
      );
    }

    totalBytes += file.size;

    if (totalBytes > MAX_FOLDER_TOTAL_BYTES) {
      throw new Error(
        `The folder exceeds the ${formatMegabytes(MAX_FOLDER_TOTAL_BYTES)} MB skill size limit.`,
      );
    }
  }

  const rawEntries: Record<string, { body: Uint8Array; entryKind: "file"; isExecutable: boolean }> =
    {};

  for (const { file, path } of admitted) {
    rawEntries[path] = {
      body: new Uint8Array(await file.arrayBuffer()),
      entryKind: "file",
      isExecutable: false,
    };
  }

  const normalized = normalizeSkillEntries(rawEntries);
  const archiveBytes = new Uint8Array(createZipArchive(normalized.entries));

  return new File([archiveBytes.buffer], `${selection.folderName}.zip`, {
    type: "application/zip",
  });
}

function isIgnoredFolderPath(path: string): boolean {
  const segments = path.split("/");
  const fileName = segments.at(-1);

  if (fileName !== undefined && IGNORED_FILE_NAMES.has(fileName)) {
    return true;
  }

  return segments.some((segment) => IGNORED_DIRECTORY_SEGMENTS.has(segment));
}

async function collectDirectoryFiles(
  directory: FileSystemDirectoryEntry,
  parentPath: string,
  out: SkillFolderFile[],
): Promise<void> {
  const entries = await readAllDirectoryEntries(directory.createReader());

  for (const entry of entries) {
    const path = `${parentPath}/${entry.name}`;

    if (entry.isDirectory) {
      await collectDirectoryFiles(entry as FileSystemDirectoryEntry, path, out);
      continue;
    }

    if (entry.isFile) {
      out.push({ file: await readEntryFile(entry as FileSystemFileEntry), path });
    }
  }
}

async function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];

  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });

    if (batch.length === 0) {
      return all;
    }

    all.push(...batch);
  }
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function formatMegabytes(bytes: number): number {
  return Math.floor(bytes / 1024 / 1024);
}
