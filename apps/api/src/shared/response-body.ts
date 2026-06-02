export function toArrayBufferResponseBody(bytes: Uint8Array): ArrayBuffer {
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
