import { type } from "arktype";

export const DriverCapabilityId = type(
  '"text_stream" | "tool_stream" | "file_change" | "input_start" | "turn_cancel" | "session_stop" | "permission_request" | "native_resume" | "usage" | "visible_activity" | "mcp_execute" | "thinking_stream" | "custom_tool_execute"',
);
export type DriverCapabilityId = typeof DriverCapabilityId.infer;

export const DriverCapability = type({
  "details?": "string | undefined",
  id: DriverCapabilityId,
  status: '"supported" | "unsupported"',
  version: "1",
});
export type DriverCapability = typeof DriverCapability.infer;

export const DriverInstanceProtocol = type('"orpc-ws"');
export type DriverInstanceProtocol = typeof DriverInstanceProtocol.infer;
