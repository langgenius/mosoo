import { ArrowUpRight, BookOpen, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { HELP_DOCS_HOME_URL, searchHelpDocs } from "@/shared/config/help-docs";
import type { HelpDoc } from "@/shared/config/help-docs";
import { cn } from "@/shared/lib/class-names";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { ScrollArea } from "@/shared/ui/scroll-area";

function openDoc(url: string): void {
  globalThis.open(url, "_blank", "noopener,noreferrer");
}

export function HelpDocsDialog({
  open,
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <HelpDocsDialogContent onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function HelpDocsDialogContent({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchHelpDocs(query), [query]);
  const activeResultIndex = activeIndex >= results.length ? 0 : activeIndex;

  function handleSelect(doc: HelpDoc): void {
    openDoc(doc.url);
    onOpenChange(false);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (results.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => ((current >= results.length ? 0 : current) + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (current) =>
          ((current >= results.length ? 0 : current) - 1 + results.length) % results.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const doc = results[activeResultIndex];
      if (doc !== undefined) {
        handleSelect(doc);
      }
    }
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="gap-0 overflow-hidden p-0 sm:max-w-xl"
      initialFocus={inputRef}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>Help &amp; docs</DialogTitle>
        <DialogDescription>
          Search the Mosoo documentation hosted at mosoo.ai/docs.
        </DialogDescription>
      </DialogHeader>

      <div className="border-border-soft flex items-center gap-2.5 border-b px-4">
        <Search className="text-fg-3 size-4 shrink-0" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="Search help & documentation…"
          aria-label="Search help and documentation"
          className="h-12 border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
        />
      </div>

      <ScrollArea className="max-h-[min(60vh,420px)]">
        {results.length === 0 ? (
          <p className="text-fg-3 px-4 py-8 text-center text-sm">
            No documentation matches “{query.trim()}”.
          </p>
        ) : (
          <ul className="p-1.5">
            {results.map((doc, index) => {
              const previous = results[index - 1];
              const showSectionHeader = previous === undefined || previous.section !== doc.section;
              const isActive = index === activeResultIndex;

              return (
                <li key={doc.url}>
                  {showSectionHeader ? (
                    <div className="text-fg-3 px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                      {doc.section}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      handleSelect(doc);
                    }}
                    onMouseMove={() => {
                      setActiveIndex(index);
                    }}
                    className={cn(
                      "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] transition-colors",
                      isActive ? "bg-ink-100 text-fg-1" : "text-fg-2",
                    )}
                  >
                    <BookOpen className="text-fg-3 size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-medium">{doc.title}</span>
                    <ArrowUpRight
                      className={cn(
                        "size-3.5 shrink-0 transition-opacity",
                        isActive ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      <div className="border-border-soft flex items-center justify-between border-t px-4 py-2.5">
        <a
          href={HELP_DOCS_HOME_URL}
          target="_blank"
          rel="noreferrer"
          className="text-fg-3 hover:text-fg-1 inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Browse all docs
          <ArrowUpRight className="size-3.5" />
        </a>
        <span className="text-fg-muted hidden text-[11px] sm:inline">
          ↑↓ to navigate · ↵ to open
        </span>
      </div>
    </DialogContent>
  );
}
