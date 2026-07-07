export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteLength, byteOffset } = bytes;

  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) {
      return buffer;
    }

    return buffer.slice(byteOffset, byteOffset + byteLength);
  }

  const body = new Uint8Array(byteLength);
  body.set(bytes);
  return body.buffer;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    const byte = binary.codePointAt(index);

    if (byte === undefined) {
      throw new Error("Base64 payload is invalid.");
    }

    bytes[index] = byte;
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
