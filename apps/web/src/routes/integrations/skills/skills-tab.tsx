import { Compass, Library, Search, Sparkles, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";

import { isTruthy } from "../../../shared/lib/truthiness";
import { SkillCard } from "./skill-card";
import { SkillDetailDialog } from "./skill-detail-dialog";
import { SkillsShCatalog } from "./skills-sh-catalog";
import { UploadSkillDialog } from "./upload-skill-dialog";
import { useSkillRegistry } from "./use-skill-registry";

type SkillsTabMode = "discover" | "installed";

export function SkillsTab() {
  const registry = useSkillRegistry();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<SkillsTabMode>("installed");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return registry.personal;
    }
    return registry.personal.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q),
    );
  }, [registry.personal, search]);

  const detailSkill = isTruthy(detailSkillId) ? (registry.getSkill(detailSkillId) ?? null) : null;

  async function handleUpload(file: File) {
    const created = await registry.publishFromFile(file);
    if (created) {
      setDetailSkillId(created.id);
    }
  }

  async function handleImportUrl(url: string) {
    const created = await registry.publishFromGithub(url);
    if (created) {
      setDetailSkillId(created.id);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Skills" description="Reusable capabilities you can attach to Agents.">
        <Button
          onClick={() => {
            setUploadOpen(true);
          }}
          size="sm"
        >
          <Upload className="size-3.5" />
          Add skill
        </Button>
      </PageHeader>

      <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 pb-4 sm:px-8">
        <div
          role="tablist"
          aria-label="Skill view"
          className="border-border-subtle inline-flex h-8 items-center gap-5 border-b"
        >
          <SkillsModeButton
            active={mode === "installed"}
            icon={Library}
            label="Installed"
            onClick={() => {
              setMode("installed");
            }}
          />
          <SkillsModeButton
            active={mode === "discover"}
            icon={Compass}
            label="Discover"
            onClick={() => {
              setMode("discover");
            }}
          />
        </div>

        <div className="hidden flex-1 sm:block" />

        <div className="relative w-full sm:w-[260px]">
          <Search className="text-fg-3 absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            placeholder={mode === "installed" ? "Search installed skills…" : "Search skills.sh…"}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            className="h-8 pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-8">
        {mode === "discover" ? (
          <SkillsShCatalog
            registry={registry}
            search={search}
            onInstalled={(skillId) => {
              setMode("installed");
              setSearch("");
              setDetailSkillId(skillId);
            }}
          />
        ) : (
          <InstalledSkillsGrid
            filtered={filtered}
            loading={registry.loading}
            onOpenSkill={setDetailSkillId}
            onUpload={() => {
              setUploadOpen(true);
            }}
            search={search}
          />
        )}
      </div>

      <UploadSkillDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUpload={handleUpload}
        onImportUrl={handleImportUrl}
        registry={registry}
      />
      {detailSkill ? (
        <SkillDetailDialog
          key={detailSkill.id}
          skill={detailSkill}
          onOpenChange={(open) => {
            if (!open) {
              setDetailSkillId(null);
            }
          }}
          registry={registry}
        />
      ) : null}
    </div>
  );
}

function InstalledSkillsGrid({
  filtered,
  loading,
  onOpenSkill,
  onUpload,
  search,
}: {
  filtered: ReturnType<typeof useSkillRegistry>["personal"];
  loading: boolean;
  onOpenSkill: (skillId: string) => void;
  onUpload: () => void;
  search: string;
}) {
  if (loading) {
    return <div className="text-fg-3 py-12 text-center text-[13px]">Loading skills…</div>;
  }

  if (filtered.length === 0) {
    return <SkillsEmptyState searching={search.length > 0} onUpload={onUpload} />;
  }

  return (
    <div className={cn("grid gap-3", "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4")}>
      {filtered.map((s) => (
        <SkillCard
          key={s.id}
          skill={s}
          onOpen={() => {
            onOpenSkill(s.id);
          }}
        />
      ))}
    </div>
  );
}

function SkillsModeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      onClick={onClick}
      aria-selected={active}
      className={cn(
        "relative inline-flex h-8 items-center gap-1.5 text-[13px] font-semibold transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full",
        active ? "text-fg-1 after:bg-fg-1" : "text-fg-3 after:bg-transparent hover:text-fg-1",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function SkillsEmptyState({ onUpload, searching }: { onUpload: () => void; searching: boolean }) {
  if (searching) {
    return (
      <EmptyState
        icon={Search}
        title="No matching skills"
        description="Try a different search term."
      />
    );
  }

  return (
    <EmptyState
      icon={Sparkles}
      title="No skills yet"
      description="Upload a `SKILL.md` file, import from GitHub or skills.sh, or fork an existing skill."
    >
      <Button onClick={onUpload} size="sm">
        <Upload className="size-3.5" />
        Add skill
      </Button>
    </EmptyState>
  );
}
