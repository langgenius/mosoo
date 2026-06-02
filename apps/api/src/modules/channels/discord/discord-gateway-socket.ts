import type { DiscordGatewayWritableSocket } from "./discord-gateway-client";

export interface DiscordGatewaySocket extends DiscordGatewayWritableSocket {
  onClose(listener: (event: { code: number }) => void): void;
  onError(listener: (event: Event) => void): void;
  onMessage(listener: (event: { data: ArrayBuffer | string }) => void): void;
}

export type DiscordGatewayConnect = (url: string) => DiscordGatewaySocket;

export function createDefaultGatewaySocket(url: string): DiscordGatewaySocket {
  const socket = new WebSocket(url);

  return {
    onClose(listener) {
      socket.addEventListener("close", (event) => listener({ code: event.code }));
    },
    onError(listener) {
      socket.addEventListener("error", listener);
    },
    onMessage(listener) {
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string" || event.data instanceof ArrayBuffer) {
          listener({ data: event.data });
          return;
        }

        throw new Error("Discord Gateway message event must be text or binary.");
      });
    },
    close(code?: number, reason?: string) {
      socket.close(code, reason);
    },
    send(data: string) {
      socket.send(data);
    },
  };
}

export function readGatewayMessageText(data: ArrayBuffer | string): string {
  if (typeof data === "string") {
    return data;
  }

  return new TextDecoder().decode(data);
}
