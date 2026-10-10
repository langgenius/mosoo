import {
  getNativeCheckpointRelativePath,
  MAX_NATIVE_CHECKPOINT_MANIFEST_BYTES,
  MAX_NATIVE_CHECKPOINT_FILE_BYTES,
  MAX_NATIVE_CHECKPOINT_DIRECTORY_DEPTH,
  MAX_NATIVE_CHECKPOINT_ENTRIES,
  nativeRuntimeRefsEqual,
  parseNativeCheckpointManifest,
} from "@mosoo/agent-driver/runtime";
import type { NativeCheckpoint, NativeCheckpointManifest } from "@mosoo/agent-driver/runtime";
import { AwsClient } from "aws4fetch";

import { withDisposedRpcResult } from "../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { quoteShellArg } from "../../../shared/shell";
import { isRuntimeSandboxLocalBucketEnabled } from "./runtime-sandbox-bucket-mount";
import { decodeSandboxBackupIdForPlatform } from "./sandbox-backup-id";
import type { ExecutionSessionHandle, SandboxHandle } from "./sandbox-handles";

type NativeCheckpointRestoreBindings = Pick<ApiBindings, "SANDBOX_FILE_BUCKET_LOCAL"> &
  Partial<
    Pick<
      ApiBindings,
      | "BACKUP_BUCKET"
      | "BACKUP_BUCKET_NAME"
      | "BACKUP_BUCKET_ENDPOINT"
      | "CLOUDFLARE_ACCOUNT_ID"
      | "CLOUDFLARE_R2_ACCOUNT_ID"
      | "R2_ACCESS_KEY_ID"
      | "R2_SECRET_ACCESS_KEY"
    >
  >;

async function getNativeCheckpointArchiveDownload(
  bindings: NativeCheckpointRestoreBindings,
  backupId: string,
): Promise<{ size: number; url: string }> {
  const accountId =
    bindings.CLOUDFLARE_R2_ACCOUNT_ID?.trim() || bindings.CLOUDFLARE_ACCOUNT_ID?.trim();
  const bucketName = bindings.BACKUP_BUCKET_NAME?.trim();
  if (
    !bindings.BACKUP_BUCKET ||
    !accountId ||
    !bucketName ||
    !bindings.R2_ACCESS_KEY_ID ||
    !bindings.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      "Native checkpoint restore requires the backup bucket and R2 download credentials.",
    );
  }
  const prefix = `backups/${backupId}`;
  const metadataObject = await bindings.BACKUP_BUCKET.get(`${prefix}/meta.json`);
  if (metadataObject === null || metadataObject.size > 65_536) {
    throw new Error("Native checkpoint backup metadata is missing or invalid.");
  }
  const metadata: unknown = await metadataObject.json();
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    !("createdAt" in metadata) ||
    typeof metadata.createdAt !== "string" ||
    !("ttl" in metadata) ||
    typeof metadata.ttl !== "number" ||
    !Number.isFinite(metadata.ttl) ||
    metadata.ttl <= 0 ||
    !("sizeBytes" in metadata) ||
    typeof metadata.sizeBytes !== "number" ||
    !Number.isSafeInteger(metadata.sizeBytes) ||
    metadata.sizeBytes <= 0
  ) {
    throw new Error("Native checkpoint backup metadata is invalid.");
  }
  const expiresAt = Date.parse(metadata.createdAt) + metadata.ttl * 1_000;
  if (!Number.isFinite(expiresAt) || Date.now() + 60_000 >= expiresAt) {
    throw new Error("Native checkpoint backup has expired.");
  }
  const key = `${prefix}/data.sqsh`;
  const archive = await bindings.BACKUP_BUCKET.head(key);
  if (archive === null || archive.size !== metadata.sizeBytes) {
    throw new Error("Native checkpoint backup archive is missing or incomplete.");
  }
  const endpoint =
    bindings.BACKUP_BUCKET_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`;
  const url = new URL(
    `${endpoint.replace(/\/$/u, "")}/${encodeURIComponent(bucketName)}/${key.split("/").map(encodeURIComponent).join("/")}`,
  );
  url.searchParams.set("X-Amz-Expires", "300");
  const client = new AwsClient({
    accessKeyId: bindings.R2_ACCESS_KEY_ID,
    secretAccessKey: bindings.R2_SECRET_ACCESS_KEY,
    region: "auto",
    service: "s3",
  });
  const signed = await client.sign(new Request(url), { aws: { signQuery: true } });
  return { size: archive.size, url: signed.url };
}

// Validate in the sandbox before reading any bytes into the Worker. Native
// bundles contain provider records only; provider exporters own that allowlist.
const VERIFY_BUNDLE_SCRIPT = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const input = JSON.parse(process.argv[1]);
function directory(value) {
  const absolute = path.resolve(value);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.lstatSync(current).isDirectory()) throw new Error('Native checkpoint path is not a real directory.');
  }
}
function regular(value) {
  const stat = fs.lstatSync(value);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Native checkpoint contains a link or special file.');
  return stat;
}
function digest(value, expectedSize) {
  const fd = fs.openSync(value, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(expectedSize)) throw new Error('Native checkpoint file changed before reading.');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(65536);
    let offset = 0;
    while (offset <= expectedSize) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, expectedSize + 1 - offset), offset);
      if (count === 0) break;
      offset += count;
      if (offset > expectedSize) throw new Error('Native checkpoint file grew while reading.');
      hash.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(value, { bigint: true });
    if (offset !== expectedSize || before.dev !== current.dev || before.ino !== current.ino ||
        before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        before.mode !== after.mode || after.nlink !== 1n) throw new Error('Native checkpoint file changed while reading.');
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
function verify(root) {
  directory(root);
  const manifestPath = path.join(root, 'manifest.json');
  if (regular(manifestPath).size > input.manifestLimit) throw new Error('Native checkpoint manifest is too large.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expected = input.checkpoint;
  if (Object.keys(manifest).sort().join(',') !== 'files,formatVersion,nativeRef,runId') throw new Error('Native checkpoint manifest has unknown fields.');
  if (manifest.formatVersion !== expected.formatVersion || manifest.runId !== expected.runId ||
      !manifest.nativeRef || Object.keys(manifest.nativeRef).sort().join(',') !== 'kind,runtimeId,value' || manifest.nativeRef.kind !== expected.nativeRef.kind ||
      manifest.nativeRef.runtimeId !== expected.nativeRef.runtimeId || manifest.nativeRef.value !== expected.nativeRef.value ||
      !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > input.maxEntries) {
    throw new Error('Native checkpoint manifest does not match its committed identity.');
  }
  const files = new Map();
  for (const file of manifest.files) {
    if (Object.keys(file).sort().join(',') !== 'path,sha256,size' || typeof file.path !== 'string' || (file.path === 'manifest.json' || file.path.startsWith('manifest.json/')) || /[\\\u0000-\u001f\u007f]/u.test(file.path) ||
        file.path.split('/').some(part => !part || part === '.' || part === '..') || file.path.split('/').length > input.maxDepth ||
        !Number.isSafeInteger(file.size) || file.size < 0 || file.size > input.maxFileBytes || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(file.sha256) || files.has(file.path)) {
      throw new Error('Native checkpoint has an invalid file entry.');
    }
    files.set(file.path, file);
  }
  const seen = new Set();
  let entryCount = 0;
  function walk(dir, prefix, depth) {
    if (depth > input.maxDepth) throw new Error('Native checkpoint tree is too deep.');
    const directory = fs.opendirSync(dir);
    try {
    for (let entry; (entry = directory.readSync()) !== null;) {
      if (++entryCount > input.maxEntries) throw new Error('Native checkpoint contains too many entries.');
      const name = entry.name;
      const relative = prefix ? prefix + '/' + name : name;
      const absolute = path.join(dir, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) { walk(absolute, relative, depth + 1); continue; }
      regular(absolute);
      if (relative === 'manifest.json') continue;
      const file = files.get(relative);
      if (!file || stat.size !== file.size || digest(absolute, file.size) !== file.sha256) throw new Error('Native checkpoint file integrity check failed.');
      seen.add(relative);
    }
    } finally { directory.closeSync(); }
  }
  walk(root, '', 0);
  if (seen.size !== files.size) throw new Error('Native checkpoint is missing a required file.');
  return manifest;
}
const root = path.join(input.cwd, input.relativePath);
const manifest = verify(root);
if (input.destination) {
  directory(input.destination);
  const state = path.join(input.destination, '.state');
  if (!fs.existsSync(state)) fs.mkdirSync(state);
  directory(state);
  const parent = path.join(state, 'native-checkpoints');
  if (!fs.existsSync(parent)) fs.mkdirSync(parent);
  directory(parent);
  const target = path.join(input.destination, input.relativePath);
  const temporary = fs.mkdtempSync(path.join(parent, '.restore-'));
  const copied = path.join(temporary, 'bundle');
  try {
    fs.cpSync(root, copied, { recursive: true, force: false, errorOnExist: true });
    verify(copied);
    if (fs.existsSync(target)) { directory(target); fs.rmSync(target, { recursive: true }); }
    fs.renameSync(copied, target);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
process.stdout.write(JSON.stringify(manifest));
`;

export async function verifyNativeCheckpointBundle(
  sandbox: Pick<ExecutionSessionHandle, "exec">,
  input: { cwd: string; checkpoint: NativeCheckpoint; destination?: string },
): Promise<NativeCheckpointManifest> {
  const command = `node -e ${quoteShellArg(VERIFY_BUNDLE_SCRIPT)} ${quoteShellArg(
    JSON.stringify({
      ...input,
      manifestLimit: MAX_NATIVE_CHECKPOINT_MANIFEST_BYTES,
      maxFileBytes: MAX_NATIVE_CHECKPOINT_FILE_BYTES,
      maxDepth: MAX_NATIVE_CHECKPOINT_DIRECTORY_DEPTH,
      maxEntries: MAX_NATIVE_CHECKPOINT_ENTRIES,
      relativePath: getNativeCheckpointRelativePath(input.checkpoint.runId),
    }),
  )}`;
  return withDisposedRpcResult(sandbox.exec(command, { timeout: 60_000 }), (result) => {
    if (!result.success || result.exitCode !== 0) {
      throw new Error("Native checkpoint bundle failed verification.");
    }
    const manifest = parseNativeCheckpointManifest(JSON.parse(result.stdout));
    if (
      manifest.runId !== input.checkpoint.runId ||
      !nativeRuntimeRefsEqual(manifest.nativeRef, input.checkpoint.nativeRef)
    ) {
      throw new Error("Native checkpoint bundle identity differs from its descriptor.");
    }
    return manifest;
  });
}

export async function restoreNativeCheckpointBundle(
  bindings: NativeCheckpointRestoreBindings,
  sandbox: Pick<SandboxHandle, "exec" | "restoreBackup" | "writeFile">,
  input: { backupId: string; checkpoint: NativeCheckpoint; cwd: string },
): Promise<void> {
  const staging = `/tmp/mosoo-native-restore-${crypto.randomUUID()}`;
  const extracted = `${staging}/extracted`;
  const backupId = decodeSandboxBackupIdForPlatform(input.backupId);
  try {
    await withDisposedRpcResult(
      sandbox.exec(`mkdir -m 700 -- ${quoteShellArg(staging)}`),
      (result) => {
        if (!result.success || result.exitCode !== 0) {
          throw new Error("Native checkpoint restore staging could not be created.");
        }
      },
    );
    if (isRuntimeSandboxLocalBucketEnabled(bindings)) {
      await withDisposedRpcResult(
        sandbox.restoreBackup({ dir: extracted, id: backupId, localBucket: true }),
        () => undefined,
      );
    } else {
      const download = await getNativeCheckpointArchiveDownload(bindings, backupId);
      const archive = `${staging}/data.sqsh`;
      const downloadConfig = `${staging}/download.cfg`;
      // exec commands are logged by the Sandbox SDK; keep the temporary grant
      // in the private staging directory and remove it with the archive.
      await sandbox.writeFile(downloadConfig, `url = ${JSON.stringify(download.url)}\n`);
      // SDK restoreBackup leaves FUSE mounts and replaces the backing archive
      // for the same backup ID. Extract separately from a private download.
      const command = [
        "set -eu",
        `curl --fail --silent --show-error --connect-timeout 10 --max-time 240 --output ${quoteShellArg(archive)} --config ${quoteShellArg(downloadConfig)}`,
        `test "$(stat -c %s ${quoteShellArg(archive)})" = ${download.size}`,
        `/usr/bin/unsquashfs -no-wildcards -no-progress -d ${quoteShellArg(extracted)} ${quoteShellArg(archive)} ${quoteShellArg(getNativeCheckpointRelativePath(input.checkpoint.runId))}`,
      ].join("; ");
      await withDisposedRpcResult(sandbox.exec(command, { timeout: 300_000 }), (result) => {
        if (!result.success || result.exitCode !== 0) {
          throw new Error("Native checkpoint archive could not be downloaded or extracted.");
        }
      });
    }
    await verifyNativeCheckpointBundle(sandbox, {
      checkpoint: input.checkpoint,
      cwd: extracted,
      destination: input.cwd,
    });
  } finally {
    await withDisposedRpcResult(sandbox.exec(`rm -rf -- ${quoteShellArg(staging)}`), (result) => {
      if (!result.success || result.exitCode !== 0) {
        throw new Error("Native checkpoint restore staging could not be removed.");
      }
    });
  }
}
