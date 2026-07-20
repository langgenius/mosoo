import { createPromiseDeferred } from "@mosoo/effects";

export interface StoredUploadedPart {
  etag: string;
  partNumber: number;
}

export interface StoredFileUploadSession {
  contentType: string;
  expectedSize: number;
  expiresAt: string;
  file: Blob;
  fileId: string;
  fileName: string;
  partSize: number | null;
  path: string;
  parts: StoredUploadedPart[];
  strategy: "multipart" | "single_put";
}

function areUploadedPartsSorted(parts: StoredUploadedPart[]): boolean {
  for (let index = 1; index < parts.length; index += 1) {
    const currentPart = parts[index];
    const previousPart = parts[index - 1];

    if (currentPart && previousPart && currentPart.partNumber < previousPart.partNumber) {
      return false;
    }
  }

  return true;
}

export function mergeUploadedPart(
  parts: StoredUploadedPart[],
  part: StoredUploadedPart,
): StoredUploadedPart[] {
  const sourceParts = areUploadedPartsSorted(parts)
    ? parts
    : parts.toSorted((left, right) => left.partNumber - right.partNumber);
  const nextParts: StoredUploadedPart[] = [];
  let inserted = false;

  for (const entry of sourceParts) {
    if (entry.partNumber === part.partNumber) {
      continue;
    }

    if (!inserted && entry.partNumber > part.partNumber) {
      nextParts.push(part);
      inserted = true;
    }

    nextParts.push(entry);
  }

  if (!inserted) {
    nextParts.push(part);
  }

  return nextParts;
}

const DATABASE_NAME = "mosoo-file-uploads";
const DATABASE_VERSION = 2;
const STORE_NAME = "uploads";

async function openDatabase(): Promise<IDBDatabase> {
  const opened = createPromiseDeferred<IDBDatabase>();
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

  request.addEventListener("error", () => {
    opened.reject(request.error ?? new Error("IndexedDB open failed."));
  });

  request.addEventListener("upgradeneeded", () => {
    const database = request.result;

    if (database.objectStoreNames.contains(STORE_NAME)) {
      database.deleteObjectStore(STORE_NAME);
    }

    database.createObjectStore(STORE_NAME, {
      keyPath: "fileId",
    });
  });

  request.addEventListener("success", () => {
    opened.resolve(request.result);
  });

  return opened.promise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    return await callback(store);
  } finally {
    database.close();
  }
}

async function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  const completed = createPromiseDeferred<T>();

  request.addEventListener("error", () => {
    completed.reject(request.error ?? new Error("IndexedDB request failed."));
  });
  request.addEventListener("success", () => {
    completed.resolve(request.result);
  });

  return completed.promise;
}

export async function saveFileUploadSession(record: StoredFileUploadSession): Promise<void> {
  return withStore("readwrite", async (store) => {
    await requestToPromise(store.put(record));
  });
}

export async function getFileUploadSession(
  fileId: string,
): Promise<StoredFileUploadSession | undefined> {
  return withStore(
    "readonly",
    async (store) =>
      (await requestToPromise(store.get(fileId))) as StoredFileUploadSession | undefined,
  );
}

export async function listFileUploadSessions(): Promise<StoredFileUploadSession[]> {
  return withStore(
    "readonly",
    async (store) => (await requestToPromise(store.getAll())) as StoredFileUploadSession[],
  );
}

export async function appendUploadedPart(fileId: string, part: StoredUploadedPart): Promise<void> {
  const existing = await getFileUploadSession(fileId);

  if (!existing) {
    throw new Error(`Upload file ${fileId} was not found in IndexedDB.`);
  }

  await saveFileUploadSession({
    ...existing,
    parts: mergeUploadedPart(existing.parts, part),
  });
}

export async function removeFileUploadSession(fileId: string): Promise<void> {
  return withStore("readwrite", async (store) => {
    await requestToPromise(store.delete(fileId));
  });
}
