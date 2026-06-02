import type { ApiBindings } from "../../../platform/cloudflare/worker-types";

export function buildSkillBlobKey(organizationId: string, blobSha256: string): string {
  return `organization/${organizationId}/skill-blob/${blobSha256}.skill`;
}

export async function writeSkillBlob(
  bindings: ApiBindings,
  input: {
    blobKey: string;
    bytes: Uint8Array;
  },
): Promise<void> {
  await bindings.FILE_BUCKET.put(input.blobKey, input.bytes);
}

async function readSkillBlob(bindings: ApiBindings, blobKey: string): Promise<R2ObjectBody | null> {
  return bindings.FILE_BUCKET.get(blobKey);
}

export async function readSkillBlobBytes(
  bindings: ApiBindings,
  blobKey: string,
): Promise<Uint8Array> {
  const object = await readSkillBlob(bindings, blobKey);

  if (!object) {
    throw new Error(`Skill blob missing: ${blobKey}`);
  }

  return new Uint8Array(await object.arrayBuffer());
}
