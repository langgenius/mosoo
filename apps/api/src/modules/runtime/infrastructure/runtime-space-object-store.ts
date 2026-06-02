export interface RuntimeSpaceObjectWriteResult {
  readonly etag: string | null;
  readonly size: number;
}

interface RuntimeSpaceObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface RuntimeSpaceObjectPutResult {
  readonly etag?: string | null;
}

export interface RuntimeSpaceObjectBucket {
  delete(objectKey: string): Promise<void>;
  get(objectKey: string): Promise<RuntimeSpaceObjectBody | null>;
  put(objectKey: string, bytes: Uint8Array): Promise<RuntimeSpaceObjectPutResult | null>;
}

export async function deleteRuntimeSpaceObject(
  fileBucket: RuntimeSpaceObjectBucket,
  objectKey: string,
): Promise<void> {
  await fileBucket.delete(objectKey);
}

export async function getRuntimeSpaceObject(
  fileBucket: RuntimeSpaceObjectBucket,
  objectKey: string,
): Promise<Uint8Array | null> {
  const object = await fileBucket.get(objectKey);

  if (!object) {
    return null;
  }

  return new Uint8Array(await object.arrayBuffer());
}

export async function putRuntimeSpaceObject(
  fileBucket: RuntimeSpaceObjectBucket,
  objectKey: string,
  bytes: Uint8Array,
): Promise<RuntimeSpaceObjectWriteResult> {
  const object = await fileBucket.put(objectKey, bytes);

  return {
    etag: object?.etag ?? null,
    size: bytes.byteLength,
  };
}
