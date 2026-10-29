// Provider failures can echo credentials in arbitrary response text.
export function redactProviderCredentials(value: string, apiKey?: string): string {
  const redacted = apiKey ? value.replaceAll(apiKey, "***") : value;
  return redacted
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer ***")
    .replaceAll(/\b((?:sk|rk|pk)-|oc_sk_)[A-Za-z0-9_*.-]+/gu, "$1***");
}
