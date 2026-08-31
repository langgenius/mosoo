import type { DriverHelloInput, DriverReadyInput } from "@mosoo/agent-driver/orpc";

import type { DriverDebugResumeSnapshot } from "./debug-resume-snapshot";

export interface DriverInstanceConnectionEpoch {
  readonly connectionId: string;
  readonly generation: number;
}

export interface DriverInstanceCloseSnapshot {
  at: string;
  code: number;
  reason: string;
}

export interface DriverInstanceReadyResult {
  heartbeatCount: number;
  lastHeartbeatAt: string | null;
  ready: DriverReadyInput;
}

export interface DriverInstanceSnapshot {
  close: DriverInstanceCloseSnapshot | null;
  debugResume: DriverDebugResumeSnapshot;
  driverSocketConnected: boolean;
  heartbeatCount: number;
  hello: DriverHelloInput | null;
  lastHeartbeatAt: string | null;
}

export interface DriverInstanceWaitForCloseResult extends DriverInstanceSnapshot {
  close: DriverInstanceCloseSnapshot;
}
