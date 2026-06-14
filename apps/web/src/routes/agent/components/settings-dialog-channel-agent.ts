import type { AgentStatus } from "@mosoo/contracts/agent";

export interface ChannelInlineSetupAgent {
  id: string;
  name: string;
  appId: string;
  status: AgentStatus;
}
