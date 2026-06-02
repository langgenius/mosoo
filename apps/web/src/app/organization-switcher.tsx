import { Check, ChevronsUpDown, Loader2, Plus, User } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { createOrganization } from "@/domains/organization/api/organization-client";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { isTruthy } from "../shared/lib/truthiness";
import { useAppSession } from "./session-provider";
function OrganizationBadge({ name }: { name: string }) {
  return (
    <div
      className="flex size-[22px] shrink-0 items-center justify-center rounded-sm text-[12px] font-semibold tracking-[0.02em]"
      style={{
        background: "var(--ink-900)",
        color: "var(--green-400)",
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function OrganizationSwitcher({ collapsed }: { collapsed: boolean }) {
  const {
    activeOrganization,
    organizationCreationSlot,
    organizations,
    organizationsLoading,
    refreshOrganizations,
    setActiveOrganizationId,
  } = useAppSession();
  const [creatingKind, setCreatingKind] = useState<"personal" | "team" | null>(null);
  const [createOrganizationDialogOpen, setCreateOrganizationDialogOpen] = useState(false);
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [createOrganizationError, setCreateOrganizationError] = useState<string | null>(null);
  const activeOrganizationName =
    activeOrganization?.name ?? (organizationsLoading ? "Loading..." : "No organization");
  const personalSlotOccupied = organizations.some(
    (organization) => organization.kind === "personal",
  );
  const organizationCreationSlotOccupied = organizationCreationSlot.occupied;

  function resetCreateOrganizationDialog() {
    setNewOrganizationName("");
    setCreateOrganizationError(null);
  }

  function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unexpected error";
  }

  async function handleCreateOrganization(kind: "personal" | "team") {
    setCreatingKind(kind);

    try {
      const organization = await createOrganization({ kind });
      await Promise.all([refreshOrganizations(), setActiveOrganizationId(organization.id)]);
    } finally {
      setCreatingKind(null);
    }
  }

  async function handleCreateTeamOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = newOrganizationName.trim();

    if (!name) {
      setCreateOrganizationError("Organization name is required.");
      return;
    }

    setCreatingKind("team");
    setCreateOrganizationError(null);

    try {
      const organization = await createOrganization({ kind: "team", name });
      await Promise.all([refreshOrganizations(), setActiveOrganizationId(organization.id)]);
      setCreateOrganizationDialogOpen(false);
      resetCreateOrganizationDialog();
    } catch (error: unknown) {
      setCreateOrganizationError(getErrorMessage(error));
    } finally {
      setCreatingKind(null);
    }
  }

  function handleCreateOrganizationDialogOpenChange(open: boolean) {
    if (!open) {
      resetCreateOrganizationDialog();
    }

    setCreateOrganizationDialogOpen(open);
  }

  const trigger = collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={activeOrganizationName}
          className="hover:bg-accent/30 flex items-center justify-center self-center rounded-md p-1 transition-colors"
        >
          <OrganizationBadge name={activeOrganization?.name ?? "?"} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{activeOrganizationName}</TooltipContent>
    </Tooltip>
  ) : (
    <button
      type="button"
      className="border-border bg-card hover:bg-accent/30 flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left shadow-xs transition-colors"
    >
      <OrganizationBadge name={activeOrganization?.name ?? "?"} />
      <div className="min-w-0 flex-1">
        <div className="text-fg-muted text-[10px] font-semibold tracking-[0.14em] uppercase">
          Organization
        </div>
        <div className="text-fg-1 truncate text-[13px] font-semibold">{activeOrganizationName}</div>
      </div>
      <ChevronsUpDown className="text-fg-3 size-3.5 shrink-0" />
    </button>
  );

  return (
    <div className={cn(collapsed ? "mb-3 flex justify-center" : "mx-0.5 mb-3")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[220px] rounded-lg p-1">
          <DropdownMenuLabel className="text-muted-foreground px-2 py-1 text-[10.5px] font-semibold tracking-wider uppercase">
            Organizations
          </DropdownMenuLabel>
          {organizations.map((organization) => (
            <DropdownMenuItem
              key={organization.id}
              onSelect={() => void setActiveOrganizationId(organization.id)}
              className="cursor-pointer rounded-md"
            >
              <OrganizationBadge name={organization.name} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="truncate text-[12.5px] font-semibold">{organization.name}</div>
                  {organization.kind === "personal" ? (
                    <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-[9.5px] font-semibold">
                      Personal
                    </span>
                  ) : null}
                </div>
                <div className="text-muted-foreground truncate text-[10.5px] capitalize">
                  {organization.viewerRole}
                </div>
              </div>
              {organization.id === activeOrganization?.id ? (
                <Check className="text-accent-press size-3.5" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {!personalSlotOccupied ? (
            <DropdownMenuItem
              onSelect={() => void handleCreateOrganization("personal")}
              disabled={creatingKind !== null}
              className="cursor-pointer rounded-md"
            >
              <User className="size-3.5" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold">Create Personal Org</div>
              </div>
              {creatingKind === "personal" ? (
                <span className="text-muted-foreground text-[10.5px]">Creating</span>
              ) : null}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => {
              if (!organizationCreationSlotOccupied) {
                setCreateOrganizationDialogOpen(true);
              }
            }}
            disabled={creatingKind !== null || organizationCreationSlotOccupied}
            className="cursor-pointer rounded-md"
          >
            <Plus className="size-3.5" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold">Create Organization</div>
              {organizationCreationSlotOccupied ? (
                <div className="text-muted-foreground mt-0.5 text-[10.5px] leading-snug whitespace-normal">
                  CE allows one organization you create.
                </div>
              ) : null}
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={createOrganizationDialogOpen}
        onOpenChange={handleCreateOrganizationDialogOpenChange}
      >
        <DialogContent className="rounded-lg sm:max-w-[440px]">
          <form onSubmit={(event) => void handleCreateTeamOrganization(event)} className="contents">
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
              <DialogDescription>
                Use this for collaboration with teammates. CE allows one organization you create;
                you can still join other organizations by invite or request access.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="organization-name">Organization name</Label>
              <Input
                id="organization-name"
                value={newOrganizationName}
                onChange={(event) => {
                  setNewOrganizationName(event.target.value);
                }}
                placeholder="Acme"
                autoComplete="organization"
                disabled={creatingKind === "team"}
              />
              {isTruthy(createOrganizationError) ? (
                <p className="text-destructive text-[12px]">{createOrganizationError}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  handleCreateOrganizationDialogOpenChange(false);
                }}
                disabled={creatingKind === "team"}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creatingKind === "team" || !newOrganizationName.trim()}
              >
                {creatingKind === "team" ? <Loader2 className="size-4 animate-spin" /> : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
