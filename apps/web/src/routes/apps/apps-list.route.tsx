import type { AppSummary } from "@mosoo/contracts/app";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { createApp } from "@/domains/app/api/app-client";
import { appKeys } from "@/domains/app/query/app-queries";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

function AppCard({
  app,
  isCurrent,
  onEnter,
}: {
  app: AppSummary;
  isCurrent: boolean;
  onEnter: () => void;
}) {
  const agentsQuery = useVisibleAgentsQuery(app.id);
  const agentCount = agentsQuery.data?.length;
  const agentLabel =
    agentCount === undefined ? "—" : `${agentCount} ${agentCount === 1 ? "agent" : "agents"}`;

  return (
    <button
      type="button"
      onClick={onEnter}
      className="border-border bg-card hover:border-border-strong group flex flex-col gap-2.5 rounded-md border p-4 text-left transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-semibold">
          {app.name}
        </span>
        {isCurrent ? (
          <span className="bg-accent-soft text-accent-press rounded-full px-2 py-0.5 text-[10.5px] font-semibold">
            Current
          </span>
        ) : null}
        <ChevronRight className="text-fg-3 group-hover:text-fg-1 size-4 shrink-0 transition-colors" />
      </div>
      <div className="text-fg-2 flex items-center gap-1.5 text-xs">
        <span className="size-1.5 rounded-full bg-green-500" />
        Active
      </div>
      <div className="text-muted-foreground text-xs">{agentLabel}</div>
    </button>
  );
}

// Org-layer Apps list — the account/billing shell's view of the Apps it owns.
// Each App is a top-level resource boundary; selecting one enters its App
// console. Creating an App calls the createApp mutation, then switches into it.
export function AppsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeApp, activeOrganization, apps, appsLoading, setActiveApp } = useAppSession();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const filteredApps = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query === "" ? apps : apps.filter((app) => app.name.toLowerCase().includes(query));
  }, [apps, search]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (activeOrganization === null) {
        throw new Error("No active organization.");
      }

      return createApp({ name: name.trim(), organizationId: activeOrganization.id });
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : "Could not create App.");
    },
    onSuccess: async (app) => {
      setCreateOpen(false);
      setName("");
      setError(null);
      setActiveApp(app.id);
      await queryClient.invalidateQueries({ queryKey: appKeys.lists() });
      void navigate("/");
    },
  });

  function enterApp(appId: string) {
    setActiveApp(appId);
    void navigate("/");
  }

  function submitCreate() {
    if (name.trim().length === 0 || createMutation.isPending) {
      return;
    }

    setError(null);
    createMutation.mutate();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-7 pb-8">
        <h1 className="text-fg-1 text-[24px] font-semibold tracking-[-0.01em]">Apps</h1>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-[320px]">
            <Search className="text-fg-3 absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
            <Input
              className="h-9 pl-9"
              placeholder="Search apps…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex-1" />
          <Button
            size="sm"
            disabled={activeOrganization === null}
            onClick={() => {
              setName("");
              setError(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            New app
          </Button>
        </div>

        <div className="mt-5">
          {appsLoading ? (
            <div className="border-border bg-card text-muted-foreground rounded-md border px-4 py-6 text-sm">
              Loading Apps…
            </div>
          ) : apps.length === 0 ? (
            <div className="border-border text-muted-foreground rounded-md border border-dashed px-4 py-10 text-center text-sm">
              No Apps yet. Create one to get started.
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="border-border text-muted-foreground rounded-md border border-dashed px-4 py-10 text-center text-sm">
              No apps match “{search}”.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredApps.map((app) => (
                <AppCard
                  key={app.id}
                  app={app}
                  isCurrent={activeApp !== null && app.id === activeApp.id}
                  onEnter={() => enterApp(app.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>New app</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="new-app-name" className="text-foreground text-sm font-medium">
              App name
            </label>
            <Input
              id="new-app-name"
              placeholder="support-bot"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitCreate();
                }
              }}
            />
            {error === null ? null : <p className="text-destructive text-xs">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={name.trim().length === 0 || createMutation.isPending}
              onClick={submitCreate}
            >
              {createMutation.isPending ? "Creating…" : "Create app"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
