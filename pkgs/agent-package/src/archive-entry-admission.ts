import { ENVIRONMENT_DEFINITION_PATH, MANIFEST_PATH, MCP_JSON_PATH } from "./archive-constants";

export type AgentPackageArchiveEntryKind = "directory" | "file";

export interface AgentPackageArchiveEntryCandidate {
  entryKind: AgentPackageArchiveEntryKind;
  originalPath: string;
}

export interface AgentPackageArchiveEntry {
  entryKind: AgentPackageArchiveEntryKind;
  normalizedPath: string;
  originalPath: string;
}

export interface AgentPackageArchiveAdmissionFailure {
  code: string;
  message: string;
  normalizedPath: string | null;
  path: string | null;
}

type AgentPackageArchiveAdmissionFailureResult = {
  failure: AgentPackageArchiveAdmissionFailure;
  ok: false;
};

type AgentPackageSingleArchiveEntryAdmissionResult =
  | {
      entry: AgentPackageArchiveEntry;
      ok: true;
    }
  | AgentPackageArchiveAdmissionFailureResult;

export type AgentPackageArchiveAdmissionResult =
  | {
      entries: AgentPackageArchiveEntry[];
      ok: true;
    }
  | AgentPackageArchiveAdmissionFailureResult;

interface ZipArchiveEntryPathPair {
  centralPath: string;
  entryKind: AgentPackageArchiveEntryKind;
  localPath: string;
}

const RESERVED_AGENT_PACKAGE_ARCHIVE_FILE_PATHS = new Set([
  ENVIRONMENT_DEFINITION_PATH,
  MANIFEST_PATH,
  MCP_JSON_PATH,
]);
const zipPathDecoder = new TextDecoder("utf-8", { fatal: true });
const BYTE_VALUE_COUNT = 0x01_00;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02_01_4b_50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06_05_4b_50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04_03_4b_50;

class AgentPackageArchiveEntryReadError extends Error {
  readonly failure: AgentPackageArchiveAdmissionFailure;

  constructor(failure: AgentPackageArchiveAdmissionFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

export function admitAgentPackageArchiveEntries(
  candidates: AgentPackageArchiveEntryCandidate[],
): AgentPackageArchiveAdmissionResult {
  const admittedEntries: AgentPackageArchiveEntry[] = [];
  const paths = new Map<string, AgentPackageArchiveEntry>();
  const filePaths = new Set<string>();

  for (const candidate of candidates) {
    const admitted = admitAgentPackageArchiveEntryPath(candidate);

    if (!admitted.ok) {
      return admitted;
    }

    const entry = admitted.entry;
    const existingEntry = paths.get(entry.normalizedPath);

    if (existingEntry !== undefined) {
      return archiveEntryAdmissionFailure({
        code: "package.archive.entry_duplicate",
        message: `Package archive entry ${formatArchivePath(entry.originalPath)} collides with ${formatArchivePath(existingEntry.originalPath)} after admission.`,
        normalizedPath: entry.normalizedPath,
        path: entry.originalPath,
      });
    }

    const ancestorFilePath = findAncestorFilePath(entry.normalizedPath, filePaths);

    if (ancestorFilePath !== null) {
      return archiveEntryAdmissionFailure({
        code: "package.archive.entry_collision",
        message: `Package archive entry ${formatArchivePath(entry.originalPath)} is nested under file ${formatArchivePath(ancestorFilePath)}.`,
        normalizedPath: entry.normalizedPath,
        path: entry.originalPath,
      });
    }

    if (entry.entryKind === "file") {
      const descendantPath = findDescendantPath(entry.normalizedPath, paths);

      if (descendantPath !== null) {
        return archiveEntryAdmissionFailure({
          code: "package.archive.entry_collision",
          message: `Package archive entry ${formatArchivePath(entry.originalPath)} conflicts with existing child entry ${formatArchivePath(descendantPath)}.`,
          normalizedPath: entry.normalizedPath,
          path: entry.originalPath,
        });
      }

      filePaths.add(entry.normalizedPath);
    }

    paths.set(entry.normalizedPath, entry);
    admittedEntries.push(entry);
  }

  return {
    entries: admittedEntries,
    ok: true,
  };
}

export function admitAgentPackageZipArchiveEntries(
  bytes: Uint8Array,
): AgentPackageArchiveAdmissionResult {
  let pathPairs: ZipArchiveEntryPathPair[];

  try {
    pathPairs = readZipArchiveEntryPathPairs(bytes);
  } catch (error) {
    if (error instanceof AgentPackageArchiveEntryReadError) {
      return {
        failure: error.failure,
        ok: false,
      };
    }

    return archiveEntryAdmissionFailure({
      code: "package.archive.invalid",
      message: "Agent package must be a valid .agent archive.",
      normalizedPath: null,
      path: null,
    });
  }

  const centralAdmission = admitAgentPackageArchiveEntries(
    pathPairs.map((entry) => ({
      entryKind: entry.entryKind,
      originalPath: entry.centralPath,
    })),
  );

  if (!centralAdmission.ok) {
    return centralAdmission;
  }

  const localAdmission = admitAgentPackageArchiveEntries(
    pathPairs.map((entry) => ({
      entryKind: entry.localPath.endsWith("/") ? "directory" : "file",
      originalPath: entry.localPath,
    })),
  );

  if (!localAdmission.ok) {
    return localAdmission;
  }

  for (let index = 0; index < centralAdmission.entries.length; index += 1) {
    const centralEntry = centralAdmission.entries[index];
    const localEntry = localAdmission.entries[index];

    if (centralEntry === undefined || localEntry === undefined) {
      return archiveEntryAdmissionFailure({
        code: "package.archive.invalid",
        message: "Agent package archive entry metadata is inconsistent.",
        normalizedPath: null,
        path: null,
      });
    }

    if (
      centralEntry.entryKind !== localEntry.entryKind ||
      centralEntry.normalizedPath !== localEntry.normalizedPath
    ) {
      return archiveEntryAdmissionFailure({
        code: "package.archive.entry_mismatch",
        message: `Package archive entry ${formatArchivePath(centralEntry.originalPath)} has mismatched local metadata ${formatArchivePath(localEntry.originalPath)}.`,
        normalizedPath: centralEntry.normalizedPath,
        path: centralEntry.originalPath,
      });
    }
  }

  return centralAdmission;
}

export function findReservedAgentPackageArchiveFilePath(path: string): string | null {
  for (const reservedPath of RESERVED_AGENT_PACKAGE_ARCHIVE_FILE_PATHS) {
    if (path === reservedPath || path.startsWith(`${reservedPath}/`)) {
      return reservedPath;
    }
  }

  return null;
}

function admitAgentPackageArchiveEntryPath(
  candidate: AgentPackageArchiveEntryCandidate,
): AgentPackageSingleArchiveEntryAdmissionResult {
  const { originalPath } = candidate;

  if (originalPath.length === 0) {
    return invalidArchiveEntryPath(
      "package.archive.entry_empty",
      "Package archive entry path is empty.",
      originalPath,
    );
  }

  if (hasControlCharacter(originalPath)) {
    return invalidArchiveEntryPath(
      "package.archive.entry_control_character",
      `Package archive entry ${formatArchivePath(originalPath)} contains a control character.`,
      originalPath,
    );
  }

  if (isAbsoluteArchivePath(originalPath)) {
    return invalidArchiveEntryPath(
      "package.archive.entry_absolute",
      `Package archive entry ${formatArchivePath(originalPath)} must be relative.`,
      originalPath,
    );
  }

  if (originalPath.includes("\\")) {
    return invalidArchiveEntryPath(
      "package.archive.entry_separator",
      `Package archive entry ${formatArchivePath(originalPath)} must use forward slash separators.`,
      originalPath,
    );
  }

  const normalizedPath = originalPath.endsWith("/") ? originalPath.slice(0, -1) : originalPath;

  if (normalizedPath.length === 0) {
    return invalidArchiveEntryPath(
      "package.archive.entry_empty",
      "Package archive entry path is empty.",
      originalPath,
    );
  }

  const segments = normalizedPath.split("/");

  if (segments.some((segment) => segment.length === 0)) {
    return invalidArchiveEntryPath(
      "package.archive.entry_empty_segment",
      `Package archive entry ${formatArchivePath(originalPath)} contains an empty path segment.`,
      originalPath,
      normalizedPath,
    );
  }

  if (segments.includes(".")) {
    return invalidArchiveEntryPath(
      "package.archive.entry_current_segment",
      `Package archive entry ${formatArchivePath(originalPath)} contains a current-directory segment.`,
      originalPath,
      normalizedPath,
    );
  }

  if (segments.includes("..")) {
    return invalidArchiveEntryPath(
      "package.archive.entry_parent_segment",
      `Package archive entry ${formatArchivePath(originalPath)} contains a parent-directory segment.`,
      originalPath,
      normalizedPath,
    );
  }

  const reservedDescendantPath = findReservedAgentPackageArchiveFilePath(normalizedPath);

  if (reservedDescendantPath !== null && reservedDescendantPath !== normalizedPath) {
    return invalidArchiveEntryPath(
      "package.archive.entry_reserved",
      `Package archive entry ${formatArchivePath(originalPath)} is nested under reserved package file ${formatArchivePath(reservedDescendantPath)}.`,
      originalPath,
      normalizedPath,
    );
  }

  return {
    entry: {
      entryKind: candidate.entryKind,
      normalizedPath,
      originalPath,
    },
    ok: true,
  };
}

function invalidArchiveEntryPath(
  code: string,
  message: string,
  path: string | null,
  normalizedPath: string | null = null,
): AgentPackageArchiveAdmissionFailureResult {
  return archiveEntryAdmissionFailure({
    code,
    message,
    normalizedPath,
    path,
  });
}

function archiveEntryAdmissionFailure(
  failure: AgentPackageArchiveAdmissionFailure,
): AgentPackageArchiveAdmissionFailureResult {
  return {
    failure,
    ok: false,
  };
}

function readZipArchiveEntryPathPairs(bytes: Uint8Array): ZipArchiveEntryPathPair[] {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(bytes);

  if (endOfCentralDirectoryOffset === -1) {
    throwArchiveReadError({
      code: "package.archive.invalid",
      message: "Agent package archive is missing a central directory.",
      normalizedPath: null,
      path: null,
    });
  }

  const centralDirectorySize = readUint32LE(bytes, endOfCentralDirectoryOffset + 12);
  const centralDirectoryOffset = readUint32LE(bytes, endOfCentralDirectoryOffset + 16);

  if (centralDirectoryOffset > bytes.byteLength) {
    throwArchiveReadError({
      code: "package.archive.invalid",
      message: "Agent package archive central directory is out of bounds.",
      normalizedPath: null,
      path: null,
    });
  }

  const endOffset = centralDirectoryOffset + centralDirectorySize;

  if (endOffset > bytes.byteLength || endOffset < centralDirectoryOffset) {
    throwArchiveReadError({
      code: "package.archive.invalid",
      message: "Agent package archive central directory is out of bounds.",
      normalizedPath: null,
      path: null,
    });
  }

  const entries: ZipArchiveEntryPathPair[] = [];
  let offset = centralDirectoryOffset;

  while (offset < endOffset) {
    const signature = readUint32LE(bytes, offset);

    if (signature !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throwArchiveReadError({
        code: "package.archive.invalid",
        message: "Agent package archive central directory is corrupted.",
        normalizedPath: null,
        path: null,
      });
    }

    const fileNameLength = readUint16LE(bytes, offset + 28);
    const extraLength = readUint16LE(bytes, offset + 30);
    const commentLength = readUint16LE(bytes, offset + 32);
    const localHeaderOffset = readUint32LE(bytes, offset + 42);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > bytes.byteLength) {
      throwArchiveReadError({
        code: "package.archive.invalid",
        message: "Agent package archive entry name is out of bounds.",
        normalizedPath: null,
        path: null,
      });
    }

    const centralPath = decodeZipEntryPath(bytes.subarray(fileNameStart, fileNameEnd));
    const localPath = readLocalZipArchiveEntryPath(bytes, localHeaderOffset);

    entries.push({
      centralPath,
      entryKind: centralPath.endsWith("/") ? "directory" : "file",
      localPath,
    });

    offset = fileNameEnd + extraLength + commentLength;
  }

  if (offset !== endOffset) {
    throwArchiveReadError({
      code: "package.archive.invalid",
      message: "Agent package archive central directory is corrupted.",
      normalizedPath: null,
      path: null,
    });
  }

  return entries;
}

function readLocalZipArchiveEntryPath(bytes: Uint8Array, offset: number): string {
  const signature = readUint32LE(bytes, offset);

  if (signature !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throwArchiveReadError({
      code: "package.archive.invalid",
      message: "Agent package archive local entry metadata is corrupted.",
      normalizedPath: null,
      path: null,
    });
  }

  const fileNameLength = readUint16LE(bytes, offset + 26);
  const extraLength = readUint16LE(bytes, offset + 28);
  const fileNameStart = offset + 30;
  const fileNameEnd = fileNameStart + fileNameLength;
  const extraEnd = fileNameEnd + extraLength;

  if (fileNameEnd > bytes.byteLength || extraEnd > bytes.byteLength) {
    throwArchiveReadError({
      code: "package.archive.invalid",
      message: "Agent package archive local entry name is out of bounds.",
      normalizedPath: null,
      path: null,
    });
  }

  return decodeZipEntryPath(bytes.subarray(fileNameStart, fileNameEnd));
}

function decodeZipEntryPath(bytes: Uint8Array): string {
  try {
    return zipPathDecoder.decode(bytes);
  } catch {
    throwArchiveReadError({
      code: "package.archive.entry_encoding",
      message: "Package archive entry path must be valid UTF-8.",
      normalizedPath: null,
      path: null,
    });
  }
}

function throwArchiveReadError(failure: AgentPackageArchiveAdmissionFailure): never {
  throw new AgentPackageArchiveEntryReadError(failure);
}

function findAncestorFilePath(path: string, filePaths: Set<string>): string | null {
  const segments = path.split("/");

  for (let index = 1; index < segments.length; index += 1) {
    const ancestorPath = segments.slice(0, index).join("/");

    if (filePaths.has(ancestorPath)) {
      return ancestorPath;
    }
  }

  return null;
}

function findDescendantPath(
  path: string,
  paths: Map<string, AgentPackageArchiveEntry>,
): string | null {
  const descendantPrefix = `${path}/`;

  for (const existingPath of paths.keys()) {
    if (existingPath.startsWith(descendantPrefix)) {
      return existingPath;
    }
  }

  return null;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimumOffset = Math.max(0, bytes.byteLength - (22 + 0xff_ff));

  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (readUint32LE(bytes, offset) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }

    const commentLength = readUint16LE(bytes, offset + 20);

    if (offset + 22 + commentLength === bytes.byteLength) {
      return offset;
    }
  }

  return -1;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);

    if (charCode < 0x20 || charCode === 0x7f) {
      return true;
    }
  }

  return false;
}

function isAbsoluteArchivePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:($|[\\/])/.test(path);
}

function formatArchivePath(path: string): string {
  return JSON.stringify(path);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.byteLength) {
    throwArchiveReadError({
      code: "package.archive.invalid",
      message: "Agent package archive is corrupted.",
      normalizedPath: null,
      path: null,
    });
  }

  return readByte(bytes, offset) + readByte(bytes, offset + 1) * BYTE_VALUE_COUNT;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) {
    throwArchiveReadError({
      code: "package.archive.invalid",
      message: "Agent package archive is corrupted.",
      normalizedPath: null,
      path: null,
    });
  }

  return (
    readByte(bytes, offset) +
    readByte(bytes, offset + 1) * BYTE_VALUE_COUNT +
    readByte(bytes, offset + 2) * BYTE_VALUE_COUNT ** 2 +
    readByte(bytes, offset + 3) * BYTE_VALUE_COUNT ** 3
  );
}

function readByte(bytes: Uint8Array, offset: number): number {
  const byte = bytes[offset];

  if (byte === undefined) {
    throwArchiveReadError({
      code: "package.archive.invalid",
      message: "Agent package archive is corrupted.",
      normalizedPath: null,
      path: null,
    });
  }

  return byte;
}
