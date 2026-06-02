import { useState } from "react";

export function useRequestAccessLink({
  organizationId,
  setError,
}: {
  organizationId: string;
  setError: (error: string | null) => void;
}) {
  const [copied, setCopied] = useState(false);
  const requestAccessLink =
    globalThis.window === undefined
      ? `/join/${organizationId}`
      : `${globalThis.location.origin}/join/${organizationId}`;

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(requestAccessLink);
      setCopied(true);
      globalThis.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Unexpected error");
    }
  }

  return { copied, handleCopyLink, requestAccessLink };
}
