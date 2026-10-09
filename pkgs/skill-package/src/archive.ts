import { Unzip, UnzipInflate, zipSync } from "fflate";
import type { ZipOptions, Zippable } from "fflate";

import type { SkillPackageEntry } from "./bundle";
import { SkillPackageError } from "./errors";
import { inferSkillPackagePathKind } from "./path-admission";

const DEFAULT_ZIP_LEVEL = 6;
const FIXED_ZIP_MTIME = new Date("1980-01-01T00:00:00.000Z");
const UNIX_ZIP_OS = 3;
const EXECUTABLE_FILE_MODE = 0o10_0755;
const REGULAR_FILE_MODE = 0o10_0644;
const DIRECTORY_MODE = 0o04_0755;
const BYTE_VALUE_COUNT = 0x01_00;
const ZIP_EXTERNAL_ATTRIBUTE_MODE_FACTOR = 0x01_00_00;
const ZIP_STORED_COMPRESSION = 0;
const ZIP_DEFLATE_COMPRESSION = 8;

interface SkillArchiveExtractOptions {
  maxEntryCount?: number;
  maxFileBytes?: number;
  maxTotalFileBytes?: number;
}

interface ZipArchiveMetadata {
  isExecutable: boolean;
  path: string;
}

export function createZipArchive(entries: SkillPackageEntry[]): Uint8Array {
  const archive: Zippable = {};

  for (const entry of entries) {
    const archivePath = entry.entryKind === "directory" ? `${entry.path}/` : entry.path;

    archive[archivePath] = [entry.body, createZipEntryOptions(entry)];
  }

  try {
    return zipSync(archive);
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
  const metadataLookup = createZipMetadataLookup(listZipArchiveEntries(bytes, options));
  const extractedEntries: SkillPackageEntry[] = [];
  const extractionState: { error: SkillPackageError | null } = { error: null };
  // The central directory can under-declare or repeat the streamed entries, so
  // the stream is bounded and de-duplicated on its own.
  const extractedPaths = new Set<string>();
  let totalExtractedBytes = 0;
  const unzip = new Unzip((file) => {
    if (extractionState.error !== null) {
      file.terminate();
      return;
    }

    if (isIgnoredZipMetadataPath(file.name)) {
      return;
    }

    const metadata = metadataLookup.get(file.name);
    const path = metadata?.path ?? file.name;
    const duplicate = extractedPaths.has(path);

    if (
      duplicate ||
      (options.maxEntryCount !== undefined && extractedPaths.size >= options.maxEntryCount)
    ) {
      extractionState.error = new SkillPackageError(
        duplicate
          ? `The skill zip archive contains a duplicate entry: ${file.name}`
          : `The ZIP entry count exceeds the limit (${options.maxEntryCount}).`,
      );
      file.terminate();
      return;
    }

    extractedPaths.add(path);
    const entryKind = inferSkillPackagePathKind(path);

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

      if (entryKind === "directory") {
        if (chunk.byteLength !== 0) {
          extractionState.error = new SkillPackageError(
            `ZIP directory entries cannot contain file contents: ${file.name}`,
          );
          file.terminate();
          return;
        }
      } else if (chunk.byteLength > 0) {
        entryBytes += chunk.byteLength;
        totalExtractedBytes += chunk.byteLength;

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

        chunks.push(new Uint8Array(chunk));
      }

      if (!final) {
        return;
      }

      extractedEntries.push({
        body: entryKind === "directory" ? new Uint8Array() : concatChunks(chunks, entryBytes),
        entryKind,
        isExecutable: entryKind === "file" && (metadata?.isExecutable ?? false),
        path,
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

  return extractedEntries;
}

function createZipMetadataLookup(
  metadataByPath: ZipArchiveMetadata[],
): Map<string, ZipArchiveMetadata> {
  const metadataLookup = new Map<string, ZipArchiveMetadata>();

  for (const metadata of metadataByPath) {
    addZipMetadataLookupEntry(metadataLookup, metadata.path, metadata);

    const byteStringPath = encodeUtf8PathAsByteString(metadata.path);

    if (byteStringPath !== metadata.path) {
      addZipMetadataLookupEntry(metadataLookup, byteStringPath, metadata);
    }
  }

  return metadataLookup;
}

function addZipMetadataLookupEntry(
  metadataLookup: Map<string, ZipArchiveMetadata>,
  path: string,
  metadata: ZipArchiveMetadata,
): void {
  const existing = metadataLookup.get(path);

  if (existing === undefined || existing.path === metadata.path) {
    metadataLookup.set(path, metadata);
  }
}

function encodeUtf8PathAsByteString(path: string): string {
  const bytes = new TextEncoder().encode(path);
  const chunks: string[] = [];
  const chunkSize = 0x80_00;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }

  return chunks.join("");
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

    const path = decodeZipFileName(bytes.subarray(fileNameStart, fileNameEnd));
    const nextOffset = fileNameEnd + extraLength + commentLength;

    if (nextOffset > endOffset) {
      throw new SkillPackageError("The skill zip archive central directory exceeds bounds.");
    }

    if (isIgnoredZipMetadataPath(path)) {
      offset = nextOffset;
      continue;
    }

    const entryKind = inferSkillPackagePathKind(path);

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
      isExecutable: isZipEntryExecutable(versionMadeBy, externalAttributes),
      path,
    });

    offset = nextOffset;
  }

  return metadata;
}

function isIgnoredZipMetadataPath(path: string): boolean {
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);

  return segments.some(
    (segment) => segment === "__MACOSX" || segment === ".DS_Store" || segment.startsWith("._"),
  );
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
