import type {
  EnvironmentNetworkPolicy,
  EnvironmentPackageManager,
} from "@mosoo/contracts/environment";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import { isTruthy } from "../../../shared/lib/truthiness";
import {
  NETWORK_POLICY_LABELS,
  PACKAGE_MANAGERS,
  PACKAGE_MANAGER_LABELS,
} from "./environment-form-model";
function SelectButton({ disabled = false, label }: { disabled?: boolean; label: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        className="border-border-strong bg-card text-foreground hover:bg-paper-100 focus-visible:ring-ring flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border px-3 text-left text-sm transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        type="button"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="text-fg-3 size-4 shrink-0" />
      </button>
    </DropdownMenuTrigger>
  );
}

export function NetworkPolicySelect({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: EnvironmentNetworkPolicy) => void;
  value: EnvironmentNetworkPolicy;
}) {
  return (
    <DropdownMenu>
      <SelectButton disabled={disabled} label={NETWORK_POLICY_LABELS[value]} />
      <DropdownMenuContent
        align="start"
        className="environment-scroll-area max-h-64 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        {(["limited", "full"] as const).map((policy) => (
          <DropdownMenuItem
            className="justify-between text-sm"
            key={policy}
            onSelect={() => {
              onChange(policy);
            }}
          >
            {NETWORK_POLICY_LABELS[policy]}
            {policy === value ? <Check className="text-primary size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PackageManagerSelect({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: EnvironmentPackageManager) => void;
  value: EnvironmentPackageManager | null;
}) {
  return (
    <DropdownMenu>
      <SelectButton disabled={disabled} label={value ? PACKAGE_MANAGER_LABELS[value] : "Manager"} />
      <DropdownMenuContent
        align="start"
        className="environment-scroll-area max-h-56 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        {PACKAGE_MANAGERS.map((manager) => (
          <DropdownMenuItem
            className="justify-between font-mono text-sm"
            key={manager}
            onSelect={() => {
              onChange(manager);
            }}
          >
            {PACKAGE_MANAGER_LABELS[manager]}
            {manager === value ? <Check className="text-primary size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EnvironmentFormSection({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="border-border bg-card rounded-md border p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-fg-1 text-[15px] font-semibold">{title}</h3>
          {isTruthy(description) ? (
            <p className="text-fg-2 mt-1 text-[12px]">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
