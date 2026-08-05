import type { McpOAuthFlowState, StartMcpOAuthPayload } from "@mosoo/contracts/mcp";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { isTruthy } from "../../../shared/lib/truthiness";
import type { McpServerWithCredential } from "./mcp-types";
type Stage = "confirm" | "pending" | "done";

export type McpConnectTargetServer = Pick<
  McpServerWithCredential,
  "authType" | "id" | "name" | "url"
>;

interface Props {
  open: boolean;
  server: McpConnectTargetServer | null;
  onBearerConnect: (token: string) => Promise<void>;
  onConnected: () => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  onPollOAuthFlow: (flowId: string) => Promise<McpOAuthFlowState>;
  onStartOAuth: () => Promise<StartMcpOAuthPayload>;
}

export function OAuthConnectDialog({
  open,
  server,
  onBearerConnect,
  onConnected,
  onOpenChange,
  onPollOAuthFlow,
  onStartOAuth,
}: Props) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>("confirm");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const flowIdRef = useRef<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setStage("confirm");
        flowIdRef.current = null;
        setToken("");
        setError(null);
        popupRef.current?.close();
        popupRef.current = null;
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  useEffect(() => {
    const flowId = flowIdRef.current;

    if (!open || server?.authType !== "oauth" || stage !== "pending" || !isTruthy(flowId)) {
      return;
    }

    let cancelled = false;
    const currentFlowId = flowId;
    const serverId = server.id;

    async function pollFlowStatus() {
      try {
        const flow = await onPollOAuthFlow(currentFlowId);

        if (cancelled) {
          return;
        }

        if (flow.serverId !== serverId) {
          setStage("confirm");
          setError(t("mcp.oauthUnexpectedServer"));
          return;
        }

        if (flow.status === "pending") {
          return;
        }

        popupRef.current?.close();
        popupRef.current = null;

        if (flow.status === "succeeded") {
          setStage("done");
          setError(null);
          await Promise.resolve(onConnected());
          handleOpenChange(false);
          return;
        }

        setStage("confirm");
        setError(
          flow.errorMessage ??
            (flow.status === "expired" ? t("mcp.oauthExpired") : t("mcp.oauthFailed")),
        );
      } catch (flowError) {
        if (cancelled) {
          return;
        }

        setStage("confirm");
        setError(flowError instanceof Error ? flowError.message : t("mcp.oauthStatusCheckFailed"));
      }
    }

    void pollFlowStatus();
    const interval = globalThis.setInterval(() => {
      void pollFlowStatus();
    }, 1000);

    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [handleOpenChange, onConnected, onPollOAuthFlow, open, server, stage, t]);

  if (!server) {
    return null;
  }

  const isBearer = server.authType === "bearer";

  async function handleConfirm() {
    if (isBearer) {
      if (!token.trim()) {
        return;
      }
      setStage("pending");
      setError(null);

      try {
        await onBearerConnect(token.trim());
        setStage("done");
        await onConnected();
        handleOpenChange(false);
      } catch (connectError) {
        setStage("confirm");
        setError(connectError instanceof Error ? connectError.message : t("mcp.bearerConnectFailed"));
      }

      return;
    }

    try {
      setError(null);
      const payload = await onStartOAuth();
      const popup = window.open(payload.authorizationUrl, "_blank", "width=720,height=760");

      if (!popup) {
        setStage("confirm");
        setError(t("mcp.popupBlocked"));
        return;
      }

      popupRef.current = popup;
      flowIdRef.current = payload.flowId;
      setStage("pending");
    } catch (oauthError) {
      setStage("confirm");
      setError(oauthError instanceof Error ? oauthError.message : t("mcp.oauthStartFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isBearer ? t("mcp.connectServer", { name: server.name }) : t("mcp.authorizeServer", { name: server.name })}
          </DialogTitle>
          <DialogDescription>
            {isBearer ? t("mcp.bearerDescription") : t("mcp.oauthDescription")}
          </DialogDescription>
        </DialogHeader>

        {isBearer ? (
          <div className="space-y-1.5 py-2">
            <Label htmlFor="bearer-token">{t("mcp.bearerToken")}</Label>
            <Input
              id="bearer-token"
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
              }}
              placeholder={t("mcp.bearerTokenPlaceholder")}
            />
          </div>
        ) : stage === "confirm" ? (
          <div className="space-y-3 py-2">
            <div className="text-muted-foreground text-[12px]">{t("mcp.willOpen")}</div>
            <div className="text-muted-foreground bg-muted/50 rounded-md px-3 py-2 font-mono text-[11px] break-all">
              {server.url}
            </div>
          </div>
        ) : stage === "pending" ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <Loader2 className="text-primary size-6 animate-spin" />
            <div className="text-muted-foreground text-[13px]">
              {t("mcp.completingAuthorization")}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <div className="flex size-9 items-center justify-center rounded-full bg-green-500/15">
              <Check className="text-success-fg size-4" />
            </div>
            <div className="text-foreground text-[13px] font-medium">
              {t("mcp.authorizationComplete")}
            </div>
          </div>
        )}

        {Boolean(error) && <div className="text-destructive text-[12px]">{error}</div>}

        {stage === "confirm" && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                handleOpenChange(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button onClick={handleConfirm} disabled={isBearer && token.trim().length === 0}>
              {isBearer ? (
                t("mcp.saveToken")
              ) : (
                <>
                  <ExternalLink />
                  {t("mcp.continue")}
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
