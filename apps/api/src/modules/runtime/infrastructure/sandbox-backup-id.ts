import { isPlatformId, parsePlatformId } from "@mosoo/id";
import type { SandboxBackupId } from "@mosoo/id";

const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UUID_PAYLOAD_BITS = 122n;
const UUID_PAYLOAD_MASK = (1n << UUID_PAYLOAD_BITS) - 1n;
const UUID_STORAGE_MARKER = 5n;

// UUID v4 has 122 variable bits. Prefixing those bits with `7` plus a
// three-bit marker keeps the handle reversible inside the existing ULID-shaped column.
function encodeBase32(value: bigint): string {
  let remaining = value;
  let encoded = "";

  for (let index = 0; index < 25; index += 1) {
    encoded = BASE32_ALPHABET[Number(remaining & 31n)] + encoded;
    remaining >>= 5n;
  }

  return encoded;
}

function decodeBase32(value: string): bigint {
  let decoded = 0n;

  for (const character of value) {
    decoded = decoded * 32n + BigInt(BASE32_ALPHABET.indexOf(character));
  }

  return decoded;
}

export function encodeSandboxBackupIdForStorage(value: string): SandboxBackupId {
  if (isPlatformId(value)) {
    return value as SandboxBackupId;
  }

  if (!UUID_V4_PATTERN.test(value)) {
    throw new TypeError("sandbox backup id must be a Cloudflare UUID v4 or Mosoo ULID.");
  }

  const uuid = BigInt(`0x${value.replaceAll("-", "")}`);
  const payload =
    ((uuid >> 80n) << 74n) | (((uuid >> 64n) & 0xfffn) << 62n) | (uuid & ((1n << 62n) - 1n));
  const stored = `7${encodeBase32((UUID_STORAGE_MARKER << UUID_PAYLOAD_BITS) | payload)}`;

  return parsePlatformId<SandboxBackupId>(stored, "sandbox backup id");
}

export function decodeSandboxBackupIdForPlatform(value: string): string {
  if (!isPlatformId(value) || value[0] !== "7") {
    return value;
  }

  const encoded = decodeBase32(value.slice(1));

  if (encoded >> UUID_PAYLOAD_BITS !== UUID_STORAGE_MARKER) {
    return value;
  }

  const payload = encoded & UUID_PAYLOAD_MASK;
  const uuid =
    ((payload >> 74n) << 80n) |
    (4n << 76n) |
    (((payload >> 62n) & 0xfffn) << 64n) |
    (2n << 62n) |
    (payload & ((1n << 62n) - 1n));
  const hex = uuid.toString(16).padStart(32, "0");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}
