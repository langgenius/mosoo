import { Trash2 } from "lucide-react";
import type { ReactElement } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import type { VendorCredential } from "../../domains/vendor-credential/api/vendor-credential-client";

export function SavedCustomProviderCard({
  credential,
  onDelete,
}: {
  credential: VendorCredential & { models?: string[] | null };
  onDelete: (credential: VendorCredential) => void;
}): ReactElement {
  const models = credential.models ?? [];

  return (
    <section className="border-border bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="border-border-strong bg-card text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed text-[11px] font-semibold">
              OAI
            </span>
            <h2 className="text-foreground truncate text-sm font-semibold">{credential.name}</h2>
            <Badge variant="primary">Custom</Badge>
            <Badge variant={credential.scope === "company" ? "outline" : "secondary"}>
              {credential.scope === "company" ? "COMPANY" : "PERSONAL"}
            </Badge>
            {credential.disabledByPolicy ? (
              <Badge variant="warning">Disabled by policy</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {credential.apiBase ?? "—"} · {credential.maskedApiKey}
          </p>
        </div>
        <Button
          onClick={() => {
            onDelete(credential);
          }}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="bg-paper-200/40 space-y-1 rounded-md px-3 py-2">
        <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          Models · {models.length}
        </div>
        {models.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {models.map((modelId) => (
              <li
                className="bg-card text-foreground rounded-sm px-1.5 py-0.5 font-mono text-[12px]"
                key={modelId}
              >
                {modelId}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-muted-foreground text-[12px]">No models declared.</div>
        )}
      </div>
    </section>
  );
}
