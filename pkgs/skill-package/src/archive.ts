import { Unzip, UnzipInflate, zipSync } from "fflate";
import type { ZipOptions, Zippable } from "fflate";

import type { SkillPackageEntry } from "./bundle";
import { SkillPackageError } from "./errors";
import { admitSkillPackagePath, createSkillPackagePathAdmission } from "./path-admission";
import type { AdmittedSkillPackagePath, SkillPackagePathKind } from "./path-admission";

const DEFAULT_ZIP_OPTIONS: ZipOptions = {
  level: 6,
};
const DEFAULT_ZIP_LEVEL = 6 as const;
const FIXED_ZIP_MTIME = new Date("1980-01-01T00:00:00.000Z");
const UNIX_ZIP_OS = 3;
const EXECUTABLE_FILE_MODE = 0o10_0755;
const REGULAR_FILE_MODE = 0o10_0644;
const DIRECTORY_MODE = 0o04_0755;
const BYTE_VALUE_COUNT = 0x01_00;
const ZIP_EXTERNAL_ATTRIBUTE_MODE_FACTOR = 0x01_00_00;
const ZIP_STORED_COMPRESSION = 0;
const ZIP_DEFLATE_COMPRESSION = 8;

export interface SkillArchiveExtractOptions {
  maxEntryCount?: number;
  maxFileBytes?: number;
  maxTotalFileBytes?: number;
  /**
   * Normalized paths exempt from the reserved-key admission rule. Empty for
   * skill packages; the agent package reader passes its reserved sidecar paths
   * (e.g. `.mcp.json`) so their exported archives round-trip on import.
   */
  allowedReservedPaths?: ReadonlySet<string>;
}

interface ZipArchiveMetadata {
  entryKind: SkillPackagePathKind;
  isExecutable: boolean;
  path: string;
  uncompressedSize: number;
}

export function createZipArchive(entries: SkillPackageEntry[]): Uint8Array {
  const admission = createSkillPackagePathAdmission();
  const admittedEntries = entries.map((entry) => ({
    ...entry,
    path: admission.admit(entry.path, entry.entryKind).path,
  }));

  return createAdmittedZipArchive(admittedEntries);
}

export function createAdmittedZipArchive(entries: SkillPackageEntry[]): Uint8Array {
  const archive: Zippable = {};

  for (const entry of entries) {
    const archivePath = entry.entryKind === "directory" ? `${entry.path}/` : entry.path;

    archive[archivePath] = [entry.body, createZipEntryOptions(entry)];
  }

  try {
    return zipSync(archive, DEFAULT_ZIP_OPTIONS);
  } catch (error) {
    throw new SkillPackageError(
      error instanceof Error ? error.message : "Skill zip compression failed.",
    );
  }
}

export function extractZipArchive(
  bytes: Uint8Array,
  options: SkillArchiveExtractOptions = {},
): SkillPackageEntry[] {
  const metadataByPath = listZipArchiveEntries(bytes, options);
  const metadataLookup = new Map(metadataByPath.map((metadata) => [metadata.path, metadata]));
  const extractedEntries = new Map<string, SkillPackageEntry>();
  const extractionState: { error: SkillPackageError | null } = { error: null };
  let totalExtractedBytes = 0;
  const unzip = new Unzip((file) => {
    if (extractionState.error !== null) {
      file.terminate();
      return;
    }

    const admittedEntry = readAdmittedZipArchivePath(file.name, options.allowedReservedPaths);

    if (admittedEntry instanceof SkillPackageError) {
      extractionState.error = admittedEntry;
      file.terminate();
      return;
    }

    const metadata = metadataLookup.get(admittedEntry.path);

    if (!metadata) {
      extractionState.error = new SkillPackageError(
        `The skill zip archive contains an undeclared entry: ${file.name}`,
      );
      file.terminate();
      return;
    }

    if (metadata.entryKind !== admittedEntry.entryKind) {
      extractionState.error = new SkillPackageError(
        `ZIP entry kind does not match the central directory: ${file.name}`,
      );
      file.terminate();
      return;
    }

    if (
      file.compression !== ZIP_STORED_COMPRESSION &&
      file.compression !== ZIP_DEFLATE_COMPRESSION
    ) {
      extractionState.error = new SkillPackageError(
        `The skill zip archive uses an unsupported compression method: ${file.compression}`,
      );
      file.terminate();
      return;
    }

    const chunks: Uint8Array[] = [];
    let entryBytes = 0;

    file.ondata = (error, chunk, final) => {
      if (extractionState.error !== null) {
        return;
      }

      if (error) {
        extractionState.error = toSkillZipError(error, "Skill zip decompression failed.");
        file.terminate();
        return;
      }

      const currentChunk = chunk;

      if (metadata.entryKind === "directory") {
        if (currentChunk.byteLength !== 0) {
          extractionState.error = new SkillPackageError(
            `ZIP directory entries cannot contain file contents: ${file.name}`,
          );
          file.terminate();
          return;
        }
      } else if (currentChunk.byteLength > 0) {
        entryBytes += currentChunk.byteLength;
        totalExtractedBytes += currentChunk.byteLength;

        if (options.maxFileBytes !== undefined && entryBytes > options.maxFileBytes) {
          extractionState.error = new SkillPackageError(
            `A file inside the ZIP exceeds the limit (${options.maxFileBytes} bytes).`,
          );
          file.terminate();
          return;
        }

        if (
          options.maxTotalFileBytes !== undefined &&
          totalExtractedBytes > options.maxTotalFileBytes
        ) {
          extractionState.error = new SkillPackageError(
            `The total extracted ZIP size exceeds the limit (${options.maxTotalFileBytes} bytes).`,
          );
          file.terminate();
          return;
        }

        chunks.push(new Uint8Array(currentChunk));
      }

      if (!final) {
        return;
      }

      if (metadata.entryKind === "file" && entryBytes !== metadata.uncompressedSize) {
        extractionState.error = new SkillPackageError(
          `ZIP entry size does not match the central directory: ${file.name}`,
        );
        file.terminate();
        return;
      }

      extractedEntries.set(metadata.path, {
        body:
          metadata.entryKind === "directory" ? new Uint8Array() : concatChunks(chunks, entryBytes),
        entryKind: metadata.entryKind,
        isExecutable: metadata.isExecutable,
        path: metadata.path,
      });
    };

    file.start();
  });

  unzip.register(UnzipInflate);

  try {
    unzip.push(bytes, true);
  } catch (error) {
    throw toSkillZipError(error, "Skill zip decompression failed.");
  }

  if (extractionState.error !== null) {
    throw extractionState.error;
  }

  return metadataByPath.map((metadata) => {
    const extractedEntry = extractedEntries.get(metadata.path);

    if (!extractedEntry) {
      throw new SkillPackageError(
        `The skill zip archive is missing entry contents: ${metadata.path}`,
      );
    }

    return extractedEntry;
  });
}

export function looksLikeZipArchive(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) {
    return false;
  }

  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return false;
  }

  return (
    (bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[2] === 0x07 && bytes[3] === 0x08)
  );
}

function createZipEntryOptions(entry: SkillPackageEntry): ZipOptions {
  return {
    attrs: getZipEntryFileMode(entry) * ZIP_EXTERNAL_ATTRIBUTE_MODE_FACTOR,
    level: entry.entryKind === "directory" ? 0 : DEFAULT_ZIP_LEVEL,
    mtime: FIXED_ZIP_MTIME,
    os: UNIX_ZIP_OS,
  };
}

function getZipEntryFileMode(entry: SkillPackageEntry): number {
  if (entry.entryKind === "directory") {
    return DIRECTORY_MODE;
  }

  if (entry.isExecutable) {
    return EXECUTABLE_FILE_MODE;
  }

  return REGULAR_FILE_MODE;
}

function listZipArchiveEntries(
  bytes: Uint8Array,
  options: SkillArchiveExtractOptions,
): ZipArchiveMetadata[] {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(bytes);

  if (endOfCentralDirectoryOffset === -1) {
    throw new SkillPackageError("The skill zip archive is missing a central directory.");
  }

  const centralDirectorySize = readUint32LE(bytes, endOfCentralDirectoryOffset + 12);
  const centralDirectoryOffset = readUint32LE(bytes, endOfCentralDirectoryOffset + 16);
  const metadata: ZipArchiveMetadata[] = [];
  const admission = createSkillPackagePathAdmission(options.allowedReservedPaths);
  let totalFileBytes = 0;
  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;

  if (centralDirectoryOffset > bytes.byteLength || endOffset > bytes.byteLength) {
    throw new SkillPackageError("The skill zip archive central directory exceeds bounds.");
  }

  while (offset < endOffset) {
    const signature = readUint32LE(bytes, offset);

    if (signature !== 0x02_01_4b_50) {
      throw new SkillPackageError("The skill zip archive central directory is corrupted.");
    }

    const versionMadeBy = readUint16LE(bytes, offset + 4);
    const uncompressedSize = readUint32LE(bytes, offset + 24);
    const fileNameLength = readUint16LE(bytes, offset + 28);
    const extraLength = readUint16LE(bytes, offset + 30);
    const commentLength = readUint16LE(bytes, offset + 32);
    const externalAttributes = readUint32LE(bytes, offset + 38);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > bytes.byteLength) {
      throw new SkillPackageError("A skill zip archive filename exceeds bounds.");
    }

    const rawPath = decodeZipFileName(bytes.subarray(fileNameStart, fileNameEnd));
    const entryKind = inferZipEntryKind(rawPath);
    const path = admission.admit(rawPath, entryKind).path;

    if (options.maxEntryCount !== undefined && metadata.length >= options.maxEntryCount) {
      throw new SkillPackageError(
        `The ZIP entry count exceeds the limit (${options.maxEntryCount}).`,
      );
    }

    if (entryKind === "file") {
      if (options.maxFileBytes !== undefined && uncompressedSize > options.maxFileBytes) {
        throw new SkillPackageError(
          `A file inside the ZIP exceeds the limit (${options.maxFileBytes} bytes).`,
        );
      }

      totalFileBytes += uncompressedSize;

      if (options.maxTotalFileBytes !== undefined && totalFileBytes > options.maxTotalFileBytes) {
        throw new SkillPackageError(
          `The total extracted ZIP size exceeds the limit (${options.maxTotalFileBytes} bytes).`,
        );
      }
    }

    metadata.push({
      entryKind,
      isExecutable:
        entryKind === "directory" ? false : isZipEntryExecutable(versionMadeBy, externalAttributes),
      path,
      uncompressedSize,
    });

    offset = fileNameEnd + extraLength + commentLength;

    if (offset > endOffset) {
      throw new SkillPackageError("The skill zip archive central directory exceeds bounds.");
    }
  }

  return metadata;
}

function isZipEntryExecutable(versionMadeBy: number, externalAttributes: number): boolean {
  const operatingSystem = Math.floor(versionMadeBy / BYTE_VALUE_COUNT);

  if (operatingSystem !== UNIX_ZIP_OS) {
    return false;
  }

  const unixMode = Math.floor(externalAttributes / ZIP_EXTERNAL_ATTRIBUTE_MODE_FACTOR);
  const ownerCanExecute = Math.floor(unixMode / 0o100) % 2 === 1;
  const groupCanExecute = Math.floor(unixMode / 0o10) % 2 === 1;
  const othersCanExecute = unixMode % 2 === 1;

  return ownerCanExecute || groupCanExecute || othersCanExecute;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimumOffset = Math.max(0, bytes.byteLength - (22 + 0xff_ff));

  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      const commentLength = readUint16LE(bytes, offset + 20);

      if (offset + 22 + commentLength === bytes.byteLength) {
        return offset;
      }
    }
  }

  return -1;
}

function readAdmittedZipArchivePath(
  path: string,
  allowedReservedPaths?: ReadonlySet<string>,
): AdmittedSkillPackagePath | SkillPackageError {
  try {
    return admitSkillPackagePath(path, inferZipEntryKind(path), allowedReservedPaths);
  } catch (error) {
    return toSkillZipError(error, "Skill zip decompression failed.");
  }
}

function inferZipEntryKind(path: string): SkillPackagePathKind {
  return path.endsWith("/") || path.endsWith("\\") ? "directory" : "file";
}

function decodeZipFileName(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new SkillPackageError(
      error instanceof Error ? error.message : "The skill zip archive filename is invalid UTF-8.",
    );
  }
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  if (chunks.length === 1) {
    return chunks[0] ?? new Uint8Array();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

function toSkillZipError(error: unknown, defaultMessage: string): SkillPackageError {
  if (error instanceof SkillPackageError) {
    return error;
  }

  return new SkillPackageError(error instanceof Error ? error.message : defaultMessage);
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.byteLength) {
    throw new SkillPackageError("The skill zip archive is corrupted: 16-bit field out of bounds.");
  }

  return readByte(bytes, offset) + readByte(bytes, offset + 1) * BYTE_VALUE_COUNT;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.byteLength) {
    throw new SkillPackageError("The skill zip archive is corrupted: 32-bit field out of bounds.");
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
    throw new SkillPackageError("The skill zip archive is corrupted: byte field out of bounds.");
  }

  return byte;
}
