const secretEncoder = new TextEncoder();

async function hashSecret(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", secretEncoder.encode(value)));
}

export async function matchesInternalRouteSecret(
  submitted: string | undefined,
  configured: string,
): Promise<boolean> {
  if (!submitted) {
    return false;
  }

  const [submittedHash, configuredHash] = await Promise.all([
    hashSecret(submitted),
    hashSecret(configured),
  ]);
  let diff = submittedHash.length ^ configuredHash.length;
  const length = Math.max(submittedHash.length, configuredHash.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (submittedHash[index] ?? 0) ^ (configuredHash[index] ?? 0);
  }

  return diff === 0;
}
