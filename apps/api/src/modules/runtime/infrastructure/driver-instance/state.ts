import type { DriverHeartbeatInput, DriverHelloInput, DriverReadyInput } from "agent-driver/orpc";

import type { Deferred } from "./driver-instance-support";

export interface DriverInstanceCloseSnapshot {
  at: string;
  code: number;
  reason: string;
}

export interface DriverInstanceHeartbeatResult {
  heartbeat: DriverHeartbeatInput;
  heartbeatCount: number;
  lastHeartbeatAt: string;
}

export interface HeartbeatWaiter {
  afterCount: number;
  deferred: Deferred<DriverInstanceHeartbeatResult>;
}

export interface DriverInstanceHelloResult {
  heartbeatCount: number;
  hello: DriverHelloInput;
  lastHeartbeatAt: string | null;
}

export interface DriverInstanceReadyResult {
  heartbeatCount: number;
  lastHeartbeatAt: string | null;
  ready: DriverReadyInput;
}

export interface DriverInstanceSnapshot {
  close: DriverInstanceCloseSnapshot | null;
  driverSocketConnected: boolean;
  heartbeatCount: number;
  hello: DriverHelloInput | null;
  lastHeartbeatAt: string | null;
}

export interface DriverInstanceWaitForCloseResult extends DriverInstanceSnapshot {
  close: DriverInstanceCloseSnapshot;
}
