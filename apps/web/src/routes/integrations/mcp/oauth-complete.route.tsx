import { useSearchParams } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";

function getStatusLabel(status: string | null): string {
  switch (status) {
    case "succeeded": {
      return "mcp.oauthCompleteSucceeded";
    }
    case "failed": {
      return "mcp.oauthCompleteFailed";
    }
    case "expired": {
      return "mcp.oauthCompleteExpired";
    }
    case null: {
      return "mcp.oauthCompleteWaiting";
    }
    default: {
      return "mcp.oauthCompleteWaiting";
    }
  }
}

export function McpOAuthCompletePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const status = searchParams.get("status");
  const flowId = searchParams.get("flowId");

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center px-6">
      <div className="border-border bg-card w-full max-w-md rounded-lg border p-8 shadow-sm">
        <h1 className="text-foreground text-[20px] font-semibold">MCP OAuth</h1>
        <p className="text-muted-foreground mt-3 text-sm">{t(getStatusLabel(status))}</p>
        {flowId && (
          <p className="bg-muted text-muted-foreground mt-4 rounded-md px-3 py-2 font-mono text-[12px] break-all">
            {t("mcp.flowId", { flowId })}
          </p>
        )}
      </div>
    </div>
  );
}
