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
  return bytes.toBase64();
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.fromBase64(value);
}

export function toBase64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.fromBase64(value, { alphabet: "base64url" });
}
