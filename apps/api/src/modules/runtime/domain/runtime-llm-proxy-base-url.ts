const UNSAFE_RUNTIME_LLM_PROXY_PATH_ENCODING = /%(?:25|2e|2f|5c)/iu;
const RUNTIME_LLM_PROXY_DOT_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)/u;

function readRawUrlPath(value: string): string {
  const schemeEnd = value.indexOf("://");

  if (schemeEnd === -1) {
    return "";
  }

  const authorityStart = schemeEnd + 3;
  const authorityEndOffset = value.slice(authorityStart).search(/[/?#]/u);

  if (authorityEndOffset === -1 || value[authorityStart + authorityEndOffset] !== "/") {
    return "";
  }

  const pathStart = authorityStart + authorityEndOffset;
  const queryStart = value.indexOf("?", pathStart);
  const fragmentStart = value.indexOf("#", pathStart);
  const pathEnd = [queryStart, fragmentStart]
    .filter((index) => index !== -1)
    .reduce((earliest, index) => Math.min(earliest, index), value.length);

  return value.slice(pathStart, pathEnd);
}

export function enforceCanonicalRuntimeLlmProxyBaseUrl(baseUrl: string): void {
  const parsed = new URL(baseUrl);
  const rawPath = readRawUrlPath(baseUrl);

  if (
    parsed.hash !== "" ||
    baseUrl.includes("\\") ||
    rawPath.includes("//") ||
    UNSAFE_RUNTIME_LLM_PROXY_PATH_ENCODING.test(rawPath) ||
    RUNTIME_LLM_PROXY_DOT_SEGMENT.test(rawPath)
  ) {
    throw new Error("Custom endpoint path is not canonical for runtime proxying.");
  }
}
