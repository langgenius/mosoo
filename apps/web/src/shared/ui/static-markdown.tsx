import type { ReactElement } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/shared/lib/class-names";

interface StaticMarkdownProps {
  children: string;
  className?: string;
}

const staticMarkdownComponents: Components = {
  a: ({ children, className, href, rel, target, ...props }) => {
    const shouldOpenInNewTab = typeof href === "string" && href.length > 0 && !href.startsWith("#");

    return (
      <a
        {...props}
        className={cn(
          "underline decoration-current/40 underline-offset-3 transition-colors",
          className,
        )}
        href={href}
        rel={shouldOpenInNewTab ? (rel ?? "noopener noreferrer") : rel}
        target={shouldOpenInNewTab ? (target ?? "_blank") : target}
      >
        {children}
      </a>
    );
  },
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn("mb-3 border-l-2 border-border pl-3 text-muted-foreground", className)}
      {...props}
    />
  ),
  code: ({ className, ...props }) => (
    <code
      className={cn(
        "rounded bg-muted/70 px-1 py-0.5 font-mono text-[0.92em] text-foreground",
        className,
      )}
      {...props}
    />
  ),
  em: ({ className, ...props }) => <em className={cn("italic", className)} {...props} />,
  h1: ({ children, className, ...props }) => (
    <h1 className={cn("mt-2 mb-3 text-[16px] font-semibold text-foreground", className)} {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, className, ...props }) => (
    <h2
      className={cn("mt-5 mb-2 text-[14.5px] font-semibold text-foreground", className)}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, className, ...props }) => (
    <h3
      className={cn("mt-4 mb-1.5 text-[13.5px] font-semibold text-foreground", className)}
      {...props}
    >
      {children}
    </h3>
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn("my-4 border-border", className)} {...props} />
  ),
  li: ({ className, ...props }) => <li className={cn("leading-relaxed", className)} {...props} />,
  ol: ({ className, ...props }) => (
    <ol
      className={cn("mb-3 ml-5 list-decimal space-y-1 marker:text-muted-foreground/70", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("mb-3 leading-relaxed", className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "mb-3 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[12px] leading-relaxed",
        className,
      )}
      {...props}
    />
  ),
  strong: ({ className, ...props }) => (
    <strong className={cn("font-semibold text-foreground", className)} {...props} />
  ),
  table: ({ className, ...props }) => (
    <div className="mb-3 overflow-x-auto">
      <table className={cn("w-full border-collapse text-[12.5px]", className)} {...props} />
    </div>
  ),
  td: ({ className, ...props }) => (
    <td className={cn("border border-border px-2 py-1", className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "border border-border bg-muted/40 px-2 py-1 text-left font-semibold",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn("mb-3 ml-5 list-disc space-y-1 marker:text-muted-foreground/60", className)}
      {...props}
    />
  ),
};

const staticRemarkPlugins = [remarkGfm];

export function StaticMarkdown({ children, className }: StaticMarkdownProps): ReactElement {
  return (
    <div
      className={cn(
        "space-y-3 break-words text-[13.5px] leading-relaxed text-foreground",
        "[&_a]:text-primary [&_a:hover]:text-primary/80",
        className,
      )}
    >
      <ReactMarkdown components={staticMarkdownComponents} remarkPlugins={staticRemarkPlugins}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
