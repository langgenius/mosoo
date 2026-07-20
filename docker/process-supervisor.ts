export type ForwardedSignal = "SIGINT" | "SIGTERM";

export interface ManagedProcess {
  readonly exitCode: number | null;
  kill(signal?: number | string): void;
}

export interface ProcessSupervisor {
  readonly receivedSignal: ForwardedSignal | null;
  readonly signal: ForwardedSignal | null;
  readonly stopping: boolean;
  installSignalHandlers(): () => void;
  stop(signal: ForwardedSignal): void;
  track<T extends ManagedProcess>(child: T): T;
  untrack(child: ManagedProcess): void;
}

export function createProcessSupervisor(): ProcessSupervisor {
  const activeChildren = new Set<ManagedProcess>();
  let receivedSignal: ForwardedSignal | null = null;
  let stopSignal: ForwardedSignal | null = null;

  function forwardSignal(child: ManagedProcess, signal: ForwardedSignal): void {
    if (child.exitCode !== null) {
      return;
    }
    try {
      child.kill(signal);
    } catch (error) {
      if (child.exitCode === null) {
        throw error;
      }
    }
  }

  function stop(signal: ForwardedSignal): void {
    if (stopSignal !== null) {
      return;
    }
    stopSignal = signal;
    for (const child of activeChildren) {
      forwardSignal(child, signal);
    }
  }

  function installSignalHandlers(): () => void {
    const onSigint = (): void => {
      receivedSignal = "SIGINT";
      stop("SIGINT");
    };
    const onSigterm = (): void => {
      receivedSignal = "SIGTERM";
      stop("SIGTERM");
    };
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    return () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
  }

  function track<T extends ManagedProcess>(child: T): T {
    activeChildren.add(child);
    if (stopSignal !== null) {
      forwardSignal(child, stopSignal);
    }
    return child;
  }

  return {
    get receivedSignal() {
      return receivedSignal;
    },
    get signal() {
      return stopSignal;
    },
    get stopping() {
      return stopSignal !== null;
    },
    installSignalHandlers,
    stop,
    track,
    untrack(child) {
      activeChildren.delete(child);
    },
  };
}
