import type { ConnectionState } from "@cloudflare/sandbox/xterm";

interface ClearableTerminal {
  clear: () => void;
}

interface TerminalConnectionState {
  readonly state: ConnectionState;
  readonly shouldPreserveReconnectBuffer: boolean;
}

export function installTerminalReconnectClearGuard(
  terminal: ClearableTerminal,
  connection: TerminalConnectionState,
): () => void {
  const clear = terminal.clear.bind(terminal);

  terminal.clear = () => {
    if (
      connection.shouldPreserveReconnectBuffer &&
      (connection.state === "disconnected" || connection.state === "connecting")
    ) {
      return;
    }

    clear();
  };

  return () => {
    terminal.clear = clear;
  };
}
