import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { confirmCliOAuthDeviceFlow } from "@/domains/auth/api/cli-oauth-client";
import { Button } from "@/shared/ui/button";

export function CliAuthPage() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code")?.trim() ?? "";
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [confirming, setConfirming] = useState(false);
  const canConfirm = code !== "" && !confirming && status === null;

  async function handleConfirm(): Promise<void> {
    setConfirming(true);
    setError(null);

    try {
      const result = await confirmCliOAuthDeviceFlow(code);
      setStatus(result.status);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError : new Error("Failed to authorize CLI."));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-6 py-12">
      <div className="border-border-default bg-bg-elevated rounded-lg border p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="bg-accent-soft text-accent flex size-10 shrink-0 items-center justify-center rounded-md">
            <KeyRound className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-fg-1 text-lg font-semibold">Authorize CLI access</h1>
            <p className="text-fg-2 mt-2 text-sm leading-6">
              Connect this browser session to the mosoo CLI request below.
            </p>
            <div className="border-border-default bg-bg-sunken text-fg-1 mt-4 rounded-md border px-3 py-2 font-mono text-sm">
              {code || "Missing code"}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button disabled={!canConfirm} onClick={() => void handleConfirm()}>
            {confirming ? <Loader2 className="size-4 animate-spin" /> : null}
            Authorize CLI
          </Button>
          <StatusMessage error={error} status={status} />
        </div>
      </div>
    </main>
  );
}

function StatusMessage({ error, status }: { error: Error | null; status: string | null }) {
  if (error) {
    return (
      <p className="text-danger inline-flex items-center gap-2 text-sm">
        <AlertCircle className="size-4" />
        {error.message}
      </p>
    );
  }

  if (status === "authorized") {
    return (
      <p className="text-success inline-flex items-center gap-2 text-sm">
        <CheckCircle2 className="success-check-enter size-4" />
        CLI access authorized.
      </p>
    );
  }

  if (status === "expired") {
    return (
      <p className="text-danger inline-flex items-center gap-2 text-sm">
        <AlertCircle className="size-4" />
        This code has expired.
      </p>
    );
  }

  if (status === "consumed") {
    return (
      <p className="text-fg-2 inline-flex items-center gap-2 text-sm">
        <CheckCircle2 className="size-4" />
        This code has already been used.
      </p>
    );
  }

  if (status) {
    return <p className="text-fg-2 text-sm">Status: {status}</p>;
  }

  return null;
}
