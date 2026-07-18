import { useSearchParams } from "react-router-dom";

function getStatusLabel(status: string | null): string {
  switch (status) {
    case "succeeded": {
      return "Authorization complete. You can close this window.";
    }
    case "failed": {
      return "Authorization failed. You can close this window and try again.";
    }
    case "expired": {
      return "Authorization expired. You can close this window and start again.";
    }
    case null: {
      return "Waiting for the authorization result.";
    }
    default: {
      return "Waiting for the authorization result.";
    }
  }
}

export function McpOAuthCompletePage() {
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status");
  const flowId = searchParams.get("flowId");

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center px-6">
      <div className="border-border bg-card w-full max-w-md rounded-lg border p-8 shadow-sm">
        <h1 className="text-foreground text-[20px] font-semibold">MCP OAuth</h1>
        <p className="text-muted-foreground mt-3 text-sm">{getStatusLabel(status)}</p>
        {flowId && (
          <p className="bg-muted text-muted-foreground mt-4 rounded-md px-3 py-2 font-mono text-[12px] break-all">
            Flow: {flowId}
          </p>
        )}
      </div>
    </div>
  );
}
