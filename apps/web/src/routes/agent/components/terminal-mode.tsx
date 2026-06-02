import { SandboxAddon } from "@cloudflare/sandbox/xterm";
import type { ConnectionState } from "@cloudflare/sandbox/xterm";
import { getAgentKindRuntimePolicy } from "@mosoo/contracts/agent";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTermTerminal } from "@xterm/xterm";
import { Circle, RefreshCw, Terminal as TerminalIcon, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";

import "@xterm/xterm/css/xterm.css";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

import type { Agent } from "../agent.types";
import { installTerminalReconnectClearGuard } from "../terminal-reconnect-buffer";

interface OwnerDebugTerminalController {
  connectionError: string | null;
  connectionState: ConnectionState;
  containerRef: RefObject<HTMLDivElement | null>;
  reconnect: () => void;
}

function buildOwnerDebugTerminalWebSocketUrl(input: { agentId: string; origin: string }): string {
  return new URL(
    `/api/agent/${encodeURIComponent(input.agentId)}/owner-debug-terminal/ws`,
    input.origin,
  ).toString();
}

function useOwnerDebugTerminalController(agentId: string): OwnerDebugTerminalController {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasConnectedOnceRef = useRef(false);
  const preserveReconnectBufferRef = useRef(false);
  const sandboxAddonRef = useRef<SandboxAddon | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return () => {
        /* Empty */
      };
    }

    let frameId: number | null = null;
    let mounted = true;
    const terminal = new XTermTerminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: 10_000,
      theme: {
        background: "#090b0f",
        cursor: "#86efac",
        foreground: "#e5e7eb",
        selectionBackground: "#2563eb55",
      },
    });
    const fitAddon = new FitAddon();
    const sandboxAddon = new SandboxAddon({
      getWebSocketUrl: ({ origin, sandboxId }) =>
        buildOwnerDebugTerminalWebSocketUrl({
          agentId: sandboxId,
          origin,
        }),
      onStateChange: (state, error) => {
        if (!mounted) {
          return;
        }
        if (state === "disconnected" && hasConnectedOnceRef.current) {
          preserveReconnectBufferRef.current = true;
        }
        if (state === "connected") {
          hasConnectedOnceRef.current = true;
          preserveReconnectBufferRef.current = false;
        }
        setConnectionState(state === "disconnected" && !error ? "connecting" : state);
        setConnectionError(error?.message ?? null);
      },
    });
    const removeReconnectClearGuard = installTerminalReconnectClearGuard(terminal, {
      get shouldPreserveReconnectBuffer() {
        return preserveReconnectBufferRef.current;
      },
      get state() {
        return sandboxAddon.state;
      },
    });

    function fitTerminal(): void {
      if (!mounted) {
        return;
      }
      try {
        fitAddon.fit();
      } catch (error) {
        setConnectionError(error instanceof Error ? error.message : "Terminal resize failed.");
      }
    }

    function scheduleFit(): void {
      if (frameId !== null) {
        globalThis.cancelAnimationFrame(frameId);
      }
      frameId = globalThis.requestAnimationFrame(() => {
        frameId = null;
        fitTerminal();
      });
    }

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(sandboxAddon);
    terminal.open(container);
    sandboxAddonRef.current = sandboxAddon;
    scheduleFit();
    terminal.focus();
    sandboxAddon.connect({ sandboxId: agentId });

    const resizeObserver =
      globalThis.ResizeObserver === undefined
        ? null
        : new globalThis.ResizeObserver(() => {
            scheduleFit();
          });
    resizeObserver?.observe(container);
    globalThis.addEventListener("resize", scheduleFit);

    return () => {
      mounted = false;
      if (frameId !== null) {
        globalThis.cancelAnimationFrame(frameId);
      }
      globalThis.removeEventListener("resize", scheduleFit);
      resizeObserver?.disconnect();
      sandboxAddon.disconnect();
      sandboxAddon.dispose();
      if (sandboxAddonRef.current === sandboxAddon) {
        sandboxAddonRef.current = null;
      }
      removeReconnectClearGuard();
      terminal.dispose();
    };
  }, [agentId]);

  const reconnect = useCallback(() => {
    const sandboxAddon = sandboxAddonRef.current;
    if (sandboxAddon === null) {
      return;
    }

    setConnectionError(null);
    preserveReconnectBufferRef.current = hasConnectedOnceRef.current;
    sandboxAddon.disconnect();
    setConnectionState("connecting");
    sandboxAddon.connect({ sandboxId: agentId });
  }, [agentId]);

  return {
    connectionError,
    connectionState,
    containerRef,
    reconnect,
  };
}

function getConnectionLabel(state: ConnectionState): string {
  if (state === "connected") {
    return "connected";
  }
  if (state === "connecting") {
    return "connecting";
  }
  return "disconnected";
}

function getConnectionTone(state: ConnectionState): string {
  if (state === "connected") {
    return "text-emerald-300";
  }
  if (state === "connecting") {
    return "text-amber-200";
  }
  return "text-red-300";
}

export function TerminalMode({ agent }: { agent: Agent }): ReactElement {
  const { connectionError, connectionState, containerRef, reconnect } =
    useOwnerDebugTerminalController(agent.id);
  const runtimePolicy = getAgentKindRuntimePolicy(agent.kind);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0e1014] text-white">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-5">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalIcon className="size-4 shrink-0 text-emerald-300" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">Owner Debug Terminal</div>
            <div className="truncate font-mono text-[10.5px] text-white/45">
              {runtimePolicy.terminal.summary}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-medium",
              getConnectionTone(connectionState),
            )}
          >
            <Circle className="size-2 fill-current" />
            <span>{getConnectionLabel(connectionState)}</span>
          </div>
          <Button
            aria-label="Reconnect owner debug terminal"
            className="border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10 hover:text-white"
            onClick={reconnect}
            size="icon-sm"
            variant="outline"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 items-start gap-2 border-b border-amber-300/20 bg-amber-300/10 px-5 py-2 text-[12px] leading-5 text-amber-50">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-200" />
        <span className="min-w-0">
          Live sandbox shell. Commands run as root and can change sandbox state, including
          /workspace, session directories, Space mounts, runtime state, and cache.
        </span>
      </div>

      {connectionError !== null ? (
        <div className="shrink-0 border-b border-red-300/20 bg-red-400/10 px-5 py-2 font-mono text-[11px] text-red-100">
          {connectionError}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#090b0f] p-3">
        {connectionState === "connecting" ? (
          <div className="pointer-events-none absolute top-5 left-5 z-10 rounded-md border border-amber-200/20 bg-black/70 px-3 py-2 text-[12px] text-amber-50 shadow-lg">
            Connecting… first launch may take a few seconds while the sandbox wakes.
          </div>
        ) : null}
        <div
          ref={containerRef}
          className="h-full min-h-0 w-full overflow-hidden [&_.xterm]:h-full [&_.xterm]:w-full [&_.xterm-screen]:outline-none"
        />
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-black/30 px-5 py-1.5 font-mono text-[10.5px] text-white/40">
        <span className="min-w-0 truncate">agent {agent.name}</span>
        <span className="shrink-0">root sandbox shell</span>
      </div>
    </div>
  );
}
