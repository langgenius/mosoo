import { Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import type { ReactElement } from "react";
import { useRef } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import type {
  CustomProviderForm,
  TestConnectionState,
} from "../../domains/vendor-credential/model/provider-credentials-model";
import { RETRY_PROVIDER_CHECK_TEXT } from "../../domains/vendor-credential/model/provider-readiness-copy";
import { ProviderTestStatus } from "./provider-test-status";

let nextModelRowKey = 0;

function createModelRowKey(): string {
  nextModelRowKey += 1;
  return `custom-provider-model-${nextModelRowKey}`;
}

function getConnectionTestLabel(testState: TestConnectionState): string {
  if (testState === "running") {
    return "Testing...";
  }

  return testState === "failure" ? RETRY_PROVIDER_CHECK_TEXT : "Test";
}

export function CustomProviderCard({
  form,
  onCancel,
  onDelete,
  onFormChange,
  onSave,
  onShowKeyChange,
  onTestConnection,
  showKey,
  testError,
  testState,
}: {
  form: CustomProviderForm;
  onCancel: () => void;
  onDelete: () => void;
  onFormChange: (form: CustomProviderForm) => void;
  onSave: () => void;
  onShowKeyChange: (visible: boolean) => void;
  onTestConnection: () => void;
  showKey: boolean;
  testError: string | null;
  testState: TestConnectionState;
}): ReactElement {
  const modelRowKeysRef = useRef<string[]>([]);

  while (modelRowKeysRef.current.length < form.models.length) {
    modelRowKeysRef.current.push(createModelRowKey());
  }

  if (modelRowKeysRef.current.length > form.models.length) {
    modelRowKeysRef.current.length = form.models.length;
  }

  function getModelRowKey(index: number): string {
    const existing = modelRowKeysRef.current[index];

    if (existing !== undefined) {
      return existing;
    }

    const nextKey = createModelRowKey();
    modelRowKeysRef.current[index] = nextKey;
    return nextKey;
  }

  function updateModel(index: number, value: string) {
    const next = [...form.models];

    next[index] = value;
    onFormChange({ ...form, models: next });
  }

  function addModelRow() {
    modelRowKeysRef.current.push(createModelRowKey());
    onFormChange({ ...form, models: [...form.models, ""] });
  }

  function removeModelRow(index: number) {
    if (form.models.length === 1) {
      onFormChange({ ...form, models: [""] });
      return;
    }

    modelRowKeysRef.current.splice(index, 1);
    onFormChange({ ...form, models: form.models.filter((_, idx) => idx !== index) });
  }

  return (
    <section className="border-accent/40 bg-card space-y-3 rounded-lg border-2 border-dashed p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-foreground truncate text-sm font-semibold">
              OpenAI-Compatible Provider · Custom
            </h2>
            <Badge variant="primary">New</Badge>
          </div>
          <p className="text-muted-foreground truncate text-xs">
            Vendor ID: openai-compatible · Unlocks runtimes accepting Custom Providers
          </p>
        </div>
        <Button onClick={onDelete} size="icon-sm" variant="ghost">
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="border-accent/40 bg-accent-soft/20 space-y-3 rounded-lg border p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1" htmlFor="custom-provider-label">
            <div className="text-muted-foreground text-xs font-medium">Label</div>
            <Input
              id="custom-provider-label"
              onChange={(event) => {
                onFormChange({ ...form, label: event.target.value });
              }}
              placeholder="Minimax"
              value={form.label}
            />
          </label>
          <label className="space-y-1" htmlFor="custom-provider-base-url">
            <div className="text-muted-foreground text-xs font-medium">Base URL</div>
            <Input
              id="custom-provider-base-url"
              onChange={(event) => {
                onFormChange({ ...form, baseUrl: event.target.value });
              }}
              placeholder="https://api.minimax.chat/v1"
              value={form.baseUrl}
            />
          </label>
        </div>

        <label className="block space-y-1" htmlFor="custom-provider-api-key">
          <div className="text-muted-foreground text-xs font-medium">API Key</div>
          <div className="flex gap-2">
            <Input
              id="custom-provider-api-key"
              onChange={(event) => {
                onFormChange({ ...form, apiKey: event.target.value });
              }}
              placeholder="sk-..."
              type={showKey ? "text" : "password"}
              value={form.apiKey}
            />
            <Button
              onClick={() => {
                onShowKeyChange(!showKey);
              }}
              size="icon"
              type="button"
              variant="outline"
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
        </label>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground text-xs font-medium">Models</div>
            <span className="text-muted-foreground/70 text-[11px]">
              One model id per row, e.g. abab6.5
            </span>
          </div>
          <div className="space-y-1.5">
            {form.models.map((modelId, index) => {
              const isLast = index === form.models.length - 1;
              const showAdd = isLast;

              return (
                <div className="flex items-center gap-2" key={getModelRowKey(index)}>
                  <Input
                    onChange={(event) => {
                      updateModel(index, event.target.value);
                    }}
                    placeholder={index === 0 ? "abab6.5" : "abab6-chat"}
                    value={modelId}
                  />
                  <Button
                    aria-label="Remove model row"
                    className="text-muted-foreground"
                    disabled={form.models.length === 1 && !modelId}
                    onClick={() => {
                      removeModelRow(index);
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-4" />
                  </Button>
                  <Button
                    aria-label="Add model row"
                    className={showAdd ? "text-muted-foreground" : "invisible"}
                    onClick={addModelRow}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              disabled={testState === "running"}
              onClick={onTestConnection}
              size="sm"
              type="button"
              variant="outline"
            >
              {getConnectionTestLabel(testState)}
            </Button>
            <ProviderTestStatus error={testError} state={testState} />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onCancel} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button onClick={onSave} size="sm">
              Save
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
