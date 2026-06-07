import type { DriverBootPayload } from "agent-driver/boot";

export interface DriverBootPayloadPreparedInput {
  readonly bootPayload: DriverBootPayload;
}

export type DriverBootPayloadPreparedHandler = (
  input: DriverBootPayloadPreparedInput,
) => Promise<void>;
