import type { ApiBindings } from "../../../platform/cloudflare/worker-types";

export interface HeadObjectResult {
  contentLength: number;
  contentType: string | null;
  etag: string;
}

export interface CreateMultipartUploadResult {
  uploadId: string;
}

export interface CopyObjectResult {
  etag: string;
}

export interface PutObjectOptions {
  ifMatch?: string | undefined;
  ifNoneMatch?: string | undefined;
}

export interface DeleteObjectOptions {
  ifMatch?: string | undefined;
}

export interface UploadMultipartPartInput {
  bindings: ApiBindings;
  body: ReadableStream<Uint8Array>;
  objectKey: string;
  partNumber: number;
  uploadId: string;
}

export interface CompleteMultipartUploadInput {
  bindings: ApiBindings;
  objectKey: string;
  parts: { etag: string; partNumber: number }[];
  uploadId: string;
}

export interface CopyObjectOptions {
  destinationIfMatch?: string;
  destinationIfNoneMatch?: string;
  sourceIfMatch?: string;
}

export interface CopyObjectInput {
  bindings: ApiBindings;
  destinationObjectKey: string;
  options?: CopyObjectOptions | undefined;
  sourceObjectKey: string;
}

export interface PutObjectInput {
  bindings: ApiBindings;
  body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob | null;
  contentType: string;
  objectKey: string;
  options?: PutObjectOptions | undefined;
}
