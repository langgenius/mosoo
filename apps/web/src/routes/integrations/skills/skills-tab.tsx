import { Search, Sparkles, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";
import { ScopeTabs } from "@/shared/ui/scope-tabs";
import type { Scope } from "@/shared/ui/scope-tabs";

import { isTruthy } from "../../../shared/lib/truthiness";
import { SkillCard } from "./skill-card";
import { SkillDetailDialog } from "./skill-detail-dialog";
import { UploadSkillDialog } from "./upload-skill-dialog";
import { useSkillRegistry } from "./use-skill-registry";
export function SkillsTab() {
  const registry = useSkillRegistry();
  const [scope, setScope] = useState<Scope>("mine");
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null);

  const scopeSkills = scope === "mine" ? registry.personal : registry.shared;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return scopeSkills;
    }
    return scopeSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q),
    );
  }, [scopeSkills, search]);

  const detailSkill = isTruthy(detailSkillId) ? (registry.getSkill(detailSkillId) ?? null) : null;

  async function handleUpload(file: File) {
    const created = await registry.publishFromFile(file);
    if (created) {
      setScope("mine");
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
          Upload skill
        </Button>
      </PageHeader>

      <div className="flex shrink-0 items-center gap-2.5 px-8 pb-4">
        <ScopeTabs
          value={scope}
          onChange={setScope}
          tabs={[
            { count: registry.personal.length, label: "Mine", value: "mine" },
            { count: registry.shared.length, label: "Shared with me", value: "shared" },
          ]}
        />

        <div className="flex-1" />

        <div className="relative w-[260px]">
          <Search className="text-fg-3 absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            placeholder="Search skills…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            className="h-8 pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {registry.loading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">Loading skills…</div>
        ) : filtered.length === 0 ? (
          <SkillsEmptyState
            kind={scope}
            searching={search.length > 0}
            onUpload={() => {
              setUploadOpen(true);
            }}
          />
        ) : (
          <div
            className={cn(
              "grid gap-3",
              "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
            )}
          >
            {filtered.map((s) => (
              <SkillCard
                key={s.id}
                skill={s}
                onOpen={() => {
                  setDetailSkillId(s.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <UploadSkillDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUpload={handleUpload}
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

function SkillsEmptyState({
  kind,
  onUpload,
  searching,
}: {
  kind: Scope;
  onUpload: () => void;
  searching: boolean;
}) {
  if (searching) {
    return (
      <EmptyState
        icon={Search}
        title="No matching skills"
        description="Try a different search term."
      />
    );
  }

  if (kind === "shared") {
    return (
      <EmptyState
        icon={Sparkles}
        title="No skills shared with you yet"
        description="Skills shared with you by teammates will appear here."
      />
    );
  }

  return (
    <EmptyState
      icon={Sparkles}
      title="No skills yet"
      description="Upload a `SKILL.md` file to get started, or fork an existing skill."
    >
      <Button onClick={onUpload} size="sm">
        <Upload className="size-3.5" />
        Upload skill
      </Button>
    </EmptyState>
  );
}
