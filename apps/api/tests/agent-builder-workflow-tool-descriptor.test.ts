import { describe, expect, test } from "bun:test";

import { listAgentBuilderWorkflowToolDescriptors } from "../src/modules/agent-builder/application/builder-workflow-tool-descriptor.service";

describe("Agent Builder workflow tool descriptors", () => {
  test("keeps Builder Assembly tools automatic and non-destructive", () => {
    const descriptors = listAgentBuilderWorkflowToolDescriptors();
    const assemblyDescriptors = descriptors.filter(
      (descriptor) => descriptor.builderAssembly === "included",
    );

    expect(assemblyDescriptors.length).toBeGreaterThan(0);

    for (const descriptor of assemblyDescriptors) {
      expect(descriptor.destructive).toBe(false);
      expect(descriptor.approvalMode).toBe("automatic");
      expect(descriptor.executionPolicy).toBe("safe_automatic");
      expect(descriptor.builderAssemblyExclusionReason).toBeUndefined();
    }

    for (const descriptor of descriptors) {
      if (descriptor.builderAssembly === "excluded") {
        expect(descriptor.builderAssemblyExclusionReason).toBeTruthy();
      }
    }
  });

  test("keeps destructive tools approval-gated", () => {
    for (const descriptor of listAgentBuilderWorkflowToolDescriptors()) {
      if (descriptor.destructive) {
        expect(descriptor.approvalMode).toBe("single_only");
      }

      if (descriptor.executionPolicy === "approval_required") {
        expect(descriptor.destructive).toBe(true);
      }
    }
  });
});
