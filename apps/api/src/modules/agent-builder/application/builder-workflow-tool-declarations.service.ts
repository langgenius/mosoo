import type { AgentBuilderWorkflowToolDescriptor } from "./builder-workflow-tool-descriptor.service";
import { listAgentBuilderAssemblyToolDescriptors } from "./builder-workflow-tool-descriptor.service";

function escapeBlockCommentText(value: string): string {
  return value.replaceAll("*/", "* /");
}

function renderToolMethodDeclaration(descriptor: AgentBuilderWorkflowToolDescriptor): string {
  return [
    "  /**",
    `   * ${escapeBlockCommentText(descriptor.description)}`,
    "   */",
    `  ${descriptor.toolId}(input?: BuilderToolPayload): Promise<BuilderToolPayload>;`,
  ].join("\n");
}

export function renderAgentBuilderAssemblyToolDeclarations(
  descriptors: readonly AgentBuilderWorkflowToolDescriptor[] = listAgentBuilderAssemblyToolDescriptors(),
): string {
  const methods = [...descriptors]
    .toSorted((left, right) => left.toolId.localeCompare(right.toolId))
    .map(renderToolMethodDeclaration)
    .join("\n\n");

  return [
    "type BuilderToolPayload = Record<string, unknown>;",
    "",
    "interface AgentBuilderAssemblyTools {",
    methods,
    "}",
    "",
    "declare const builder: AgentBuilderAssemblyTools;",
  ].join("\n");
}
