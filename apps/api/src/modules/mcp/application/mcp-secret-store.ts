import { vaultSecretsTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { PlatformId } from "@mosoo/id";
import { eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";

type VaultSecretBindings = Pick<ApiBindings, "VAULT_ROOT_SECRET">;

function requireVaultSecret(bindings: VaultSecretBindings): string {
  const secret = bindings.VAULT_ROOT_SECRET?.trim();

  if (!secret) {
    throw new Error("VAULT_ROOT_SECRET is required.");
  }

  return secret;
}

function readVaultSecretId(secretId: string): PlatformId {
  return parsePlatformId(secretId, "secretId");
}

export function requireStateSecret(bindings: ApiBindings): string {
  const secret = bindings.BETTER_AUTH_SECRET?.trim();

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required.");
  }

  return secret;
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(new TextEncoder().encode(value))),
  );
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(await sha256Bytes(secret)),
    "AES-GCM",
    false,
    ["decrypt", "encrypt"],
  );
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }

  return bytes;
}

export function toBase64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return fromBase64(padded);
}

async function encryptSecretPayload(
  rootSecret: string,
  plaintext: string,
): Promise<{
  ciphertext: string;
  ciphertextIv: string;
  wrappedDek: string;
  wrappedDekIv: string;
}> {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const contentIv = crypto.getRandomValues(new Uint8Array(12));
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const contentKey = await crypto.subtle.importKey("raw", toArrayBuffer(dek), "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
  const rootKey = await importAesKey(rootSecret);
  const ciphertext = await crypto.subtle.encrypt(
    { iv: contentIv, name: "AES-GCM" },
    contentKey,
    toArrayBuffer(new TextEncoder().encode(plaintext)),
  );
  const wrappedDek = await crypto.subtle.encrypt(
    { iv: wrapIv, name: "AES-GCM" },
    rootKey,
    toArrayBuffer(dek),
  );

  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    ciphertextIv: toBase64(contentIv),
    wrappedDek: toBase64(new Uint8Array(wrappedDek)),
    wrappedDekIv: toBase64(wrapIv),
  };
}

async function decryptSecretPayload(
  rootSecret: string,
  payload: {
    ciphertext: string;
    ciphertextIv: string;
    wrappedDek: string;
    wrappedDekIv: string;
  },
): Promise<string> {
  const rootKey = await importAesKey(rootSecret);
  const dekBytes = await crypto.subtle.decrypt(
    { iv: toArrayBuffer(fromBase64(payload.wrappedDekIv)), name: "AES-GCM" },
    rootKey,
    toArrayBuffer(fromBase64(payload.wrappedDek)),
  );
  const contentKey = await crypto.subtle.importKey("raw", dekBytes, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { iv: toArrayBuffer(fromBase64(payload.ciphertextIv)), name: "AES-GCM" },
    contentKey,
    toArrayBuffer(fromBase64(payload.ciphertext)),
  );

  return new TextDecoder().decode(plaintext);
}

export async function storeSecret(
  database: D1Database,
  bindings: ApiBindings,
  input: { kind: string; value: string },
): Promise<PlatformId> {
  const id = createPlatformId();
  const now = currentTimestampMs();
  const encrypted = await encryptSecretPayload(requireVaultSecret(bindings), input.value);

  await getAppDatabase(database)
    .insert(vaultSecretsTable)
    .values({
      algorithm: "AES-GCM",
      ciphertext: encrypted.ciphertext,
      ciphertextIv: encrypted.ciphertextIv,
      createdAt: now,
      id,
      kind: input.kind,
      updatedAt: now,
      wrappedDek: encrypted.wrappedDek,
      wrappedDekIv: encrypted.wrappedDekIv,
    })
    .run();

  return id;
}

export type SecretReadOutcome =
  | {
      status: "found";
      value: string;
    }
  | {
      reason: "secret_not_found";
      status: "missing";
    };

export async function readSecretOutcome(
  database: D1Database,
  bindings: VaultSecretBindings,
  secretId: string,
): Promise<SecretReadOutcome> {
  const vaultSecretId = readVaultSecretId(secretId);
  const row = await getAppDatabase(database)
    .select({
      ciphertext: vaultSecretsTable.ciphertext,
      ciphertextIv: vaultSecretsTable.ciphertextIv,
      wrappedDek: vaultSecretsTable.wrappedDek,
      wrappedDekIv: vaultSecretsTable.wrappedDekIv,
    })
    .from(vaultSecretsTable)
    .where(eq(vaultSecretsTable.id, vaultSecretId))
    .limit(1)
    .get();

  if (!row) {
    return { reason: "secret_not_found", status: "missing" };
  }

  return { status: "found", value: await decryptSecretPayload(requireVaultSecret(bindings), row) };
}

export async function deleteSecret(
  database: D1Database,
  secretId: string | null | undefined,
): Promise<void> {
  if (!isTruthy(secretId)) {
    return;
  }

  await getAppDatabase(database)
    .delete(vaultSecretsTable)
    .where(eq(vaultSecretsTable.id, readVaultSecretId(secretId)))
    .run();
}

export async function deleteSecretsById(
  database: D1Database,
  secretIds: readonly (string | null | undefined)[],
): Promise<void> {
  const uniqueSecretIds = [
    ...new Set(secretIds.filter((secretId): secretId is string => isTruthy(secretId))),
  ];

  if (uniqueSecretIds.length === 0) {
    return;
  }

  const vaultSecretIds = uniqueSecretIds.map(readVaultSecretId);
  await getAppDatabase(database)
    .delete(vaultSecretsTable)
    .where(inArray(vaultSecretsTable.id, vaultSecretIds))
    .run();
}
