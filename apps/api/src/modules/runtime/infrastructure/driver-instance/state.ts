export interface DriverInstanceCloseSnapshot {
  at: string;
  code: number;
  reason: string;
}

export interface DriverInstanceSnapshot {
  driverSocketConnected: boolean;
}
